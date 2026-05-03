package listener

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"

	"xenrelayproxy/internal/obs"
)

func (s *Server) startSOCKS(ctx context.Context) error {
	addr := net.JoinHostPort(s.cfg.ListenHost, strconv.Itoa(s.cfg.SOCKS5Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.socksLn = ln
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.logs.Add(obs.LevelInfo, "listener", "SOCKS5 proxy listening on "+addr)
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					continue
				}
			}
			s.wg.Add(1)
			go func() {
				defer s.wg.Done()
				s.handleSOCKS(conn)
			}()
		}
	}()
	return nil
}

func (s *Server) handleSOCKS(conn net.Conn) {
	defer conn.Close()
	br := bufio.NewReader(conn)
	if err := socksHandshake(br, conn); err != nil {
		return
	}
	host, port, err := socksRequest(br)
	if err != nil {
		_, _ = conn.Write([]byte{0x05, 0x01, 0, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	if s.router.IsBlocked(host) {
		_, _ = conn.Write([]byte{0x05, 0x02, 0, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	_, _ = conn.Write([]byte{0x05, 0x00, 0, 0x01, 0, 0, 0, 0, 0, 0})
	if s.router.ShouldBypass(host) || s.router.ShouldDirectGoogle(host) || port != "443" {
		target := net.JoinHostPort(host, port)
		if override := s.router.HostOverride(host); override != "" {
			target = net.JoinHostPort(override, port)
		}
		s.directTunnel(target, conn, br)
		return
	}
	s.handleMITMStream(host, port, conn, s.mitmModeFor(host))
}

func socksHandshake(r *bufio.Reader, w io.Writer) error {
	head := make([]byte, 2)
	if _, err := io.ReadFull(r, head); err != nil {
		return err
	}
	if head[0] != 0x05 {
		return fmt.Errorf("unsupported SOCKS version")
	}
	methods := make([]byte, int(head[1]))
	if _, err := io.ReadFull(r, methods); err != nil {
		return err
	}
	_, err := w.Write([]byte{0x05, 0x00})
	return err
}

func socksRequest(r *bufio.Reader) (string, string, error) {
	head := make([]byte, 4)
	if _, err := io.ReadFull(r, head); err != nil {
		return "", "", err
	}
	if head[0] != 0x05 || head[1] != 0x01 {
		return "", "", fmt.Errorf("only SOCKS5 CONNECT is supported")
	}
	var host string
	switch head[3] {
	case 0x01:
		ip := make([]byte, 4)
		if _, err := io.ReadFull(r, ip); err != nil {
			return "", "", err
		}
		host = net.IP(ip).String()
	case 0x03:
		length, err := r.ReadByte()
		if err != nil {
			return "", "", err
		}
		name := make([]byte, int(length))
		if _, err := io.ReadFull(r, name); err != nil {
			return "", "", err
		}
		host = string(name)
	case 0x04:
		ip := make([]byte, 16)
		if _, err := io.ReadFull(r, ip); err != nil {
			return "", "", err
		}
		host = net.IP(ip).String()
	default:
		return "", "", fmt.Errorf("unsupported SOCKS address type")
	}
	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(r, portBytes); err != nil {
		return "", "", err
	}
	port := strconv.Itoa(int(binary.BigEndian.Uint16(portBytes)))
	return host, port, nil
}
