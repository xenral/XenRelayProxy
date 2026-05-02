package listener

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"xenrelayproxy/internal/cache"
	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/mitm"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/scheduler"
)

type Relay interface {
	Do(context.Context, *http.Request) (*http.Response, error)
}

type MITMMode int

const (
	MITMRelay MITMMode = iota
	MITMSNIRewrite
)

type Server struct {
	cfg       config.Config
	relay     Relay
	mitm      *mitm.Manager
	scheduler *scheduler.Scheduler
	metrics   *obs.Metrics
	logs      *obs.Ring
	log       *slog.Logger
	router    Router
	cache     *cache.Cache

	httpServer *http.Server
	httpLn     net.Listener
	socksLn    net.Listener
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

func NewServer(cfg config.Config, relay Relay, mitmMgr *mitm.Manager, sched *scheduler.Scheduler, metrics *obs.Metrics, logs *obs.Ring, log *slog.Logger) *Server {
	if metrics == nil {
		metrics = obs.NewMetrics()
	}
	if logs == nil {
		logs = obs.NewRing(500)
	}
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg:       cfg,
		relay:     relay,
		mitm:      mitmMgr,
		scheduler: sched,
		metrics:   metrics,
		logs:      logs,
		log:       log,
		router:    NewRouter(cfg),
		cache:     cache.New(50 * 1024 * 1024),
	}
}

func (s *Server) Start(ctx context.Context) error {
	if s.relay == nil {
		return errors.New("relay is nil")
	}
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel

	addr := net.JoinHostPort(s.cfg.ListenHost, strconv.Itoa(s.cfg.ListenPort))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.httpLn = ln
	s.httpServer = &http.Server{
		Handler:           http.HandlerFunc(s.handleHTTPProxy),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.logs.Add(obs.LevelInfo, "listener", "HTTP proxy listening on "+addr)
		if err := s.httpServer.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logs.Add(obs.LevelError, "listener", "HTTP proxy stopped: "+err.Error())
		}
	}()

	if s.cfg.SOCKS5Enabled {
		if err := s.startSOCKS(ctx); err != nil {
			_ = s.Stop(context.Background())
			return err
		}
	}
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.httpServer != nil {
		_ = s.httpServer.Shutdown(ctx)
	}
	if s.socksLn != nil {
		_ = s.socksLn.Close()
	}
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) handleHTTPProxy(w http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodConnect {
		s.handleConnect(w, req)
		return
	}
	s.serveRelayed(w, req)
}

func (s *Server) handleConnect(w http.ResponseWriter, req *http.Request) {
	host, port, err := splitHostPortDefault(req.Host, "443")
	if err != nil {
		http.Error(w, "bad CONNECT target", http.StatusBadRequest)
		return
	}
	if s.router.IsBlocked(host) {
		http.Error(w, "blocked by XenRelayProxy", http.StatusForbidden)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}
	client, rw, err := hj.Hijack()
	if err != nil {
		return
	}

	if s.router.ShouldBypass(host) || s.router.ShouldDirectGoogle(host) || port != "443" {
		_, _ = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
		target := net.JoinHostPort(host, port)
		if override := s.router.HostOverride(host); override != "" {
			target = net.JoinHostPort(override, port)
		}
		s.directTunnel(target, client, rw.Reader)
		return
	}

	mode := MITMRelay
	if s.router.ShouldSNIRewrite(host) {
		mode = MITMSNIRewrite
	}
	_, _ = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
	s.handleMITMStream(host, port, client, mode)
}

func (s *Server) handleMITMStream(host, port string, raw net.Conn, mode MITMMode) {
	defer raw.Close()
	if s.mitm == nil {
		return
	}
	tlsCfg, err := s.mitm.ServerTLSConfig(host)
	if err != nil {
		s.logs.Add(obs.LevelError, "mitm", err.Error())
		return
	}
	tlsConn := tls.Server(raw, tlsCfg)
	if err := tlsConn.Handshake(); err != nil {
		s.logs.Add(obs.LevelDebug, "mitm", "TLS handshake failed for "+host+": "+err.Error())
		return
	}
	reader := bufio.NewReader(tlsConn)
	for {
		req, err := http.ReadRequest(reader)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.logs.Add(obs.LevelDebug, "mitm", "read request failed: "+err.Error())
			}
			return
		}
		s.absoluteRequestURL(req, host, port)
		if err := s.writeRequestResponse(tlsConn, req, mode); err != nil {
			s.logs.Add(obs.LevelDebug, "mitm", "write response failed: "+err.Error())
			return
		}
		if shouldClose(req.Header) {
			return
		}
	}
}

func (s *Server) writeRequestResponse(conn net.Conn, req *http.Request, mode MITMMode) error {
	var resp *http.Response
	var err error
	if mode == MITMSNIRewrite {
		resp, err = s.doSNIRewrite(req)
	} else {
		resp, err = s.responseFor(req)
	}
	if err != nil {
		resp = errorResponse(req, err, http.StatusBadGateway)
		if errors.Is(err, scheduler.ErrNoAccountAvailable) {
			resp = errorResponse(req, err, http.StatusServiceUnavailable)
		}
	}
	defer resp.Body.Close()
	return resp.Write(conn)
}

func (s *Server) serveRelayed(w http.ResponseWriter, req *http.Request) {
	resp, err := s.responseFor(req)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, scheduler.ErrNoAccountAvailable) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), status)
		return
	}
	defer resp.Body.Close()
	writeHTTPResponse(w, resp, req.Header.Get("Origin"))
}

func (s *Server) responseFor(req *http.Request) (*http.Response, error) {
	start := time.Now()
	s.absoluteProxyURL(req)
	host := req.URL.Hostname()
	if s.router.IsBlocked(host) {
		return nil, fmt.Errorf("blocked by XenRelayProxy")
	}
	if host == "_proxy_stats" {
		return s.statsResponse(req), nil
	}
	if req.Method == http.MethodOptions && req.Header.Get("Access-Control-Request-Method") != "" {
		return corsPreflightResponse(req), nil
	}
	req.RequestURI = ""

	if resp, handled, err := s.tryChunkedDownload(req); handled {
		if err != nil {
			s.metrics.Record(host, 0, 0, time.Since(start), err)
			return nil, err
		}
		s.metrics.Record(host, 0, resp.ContentLength, time.Since(start), nil)
		return resp, nil
	}

	if cache.Cacheable(req) {
		if cached, ok := s.cache.Get(req.URL.String()); ok {
			s.metrics.Record(host, 0, cached.ContentLength, time.Since(start), nil)
			return cached, nil
		}
	}

	resp, err := s.relay.Do(req.Context(), req)
	if err != nil {
		s.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, s.cfg.MaxResponseBodyBytes+1))
	_ = resp.Body.Close()
	if err != nil {
		s.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	if int64(len(body)) > s.cfg.MaxResponseBodyBytes {
		err := fmt.Errorf("relay response too large")
		s.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	if cache.Cacheable(req) {
		s.cache.Put(req.URL.String(), resp, body, cache.TTL(resp, req.URL.String()))
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	s.metrics.Record(host, requestContentLength(req), int64(len(body)), time.Since(start), nil)
	return resp, nil
}

func (s *Server) statsResponse(req *http.Request) *http.Response {
	stats := map[string]any{
		"metrics": s.metrics.Snapshot(),
		"logs":    s.logs.Tail(200),
	}
	if s.scheduler != nil {
		stats["scheduler"] = s.scheduler.Stats()
	}
	body, _ := json.MarshalIndent(stats, "", "  ")
	return &http.Response{
		StatusCode:    http.StatusOK,
		Status:        "200 OK",
		Header:        http.Header{"Content-Type": []string{"application/json"}, "Content-Length": []string{strconv.Itoa(len(body))}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}
}

func (s *Server) absoluteProxyURL(req *http.Request) {
	if req.URL == nil || (req.URL.Scheme != "" && req.URL.Host != "") {
		return
	}
	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	req.URL.Scheme = "http"
	req.URL.Host = host
	req.RequestURI = ""
}

func (s *Server) absoluteRequestURL(req *http.Request, host, port string) {
	if req.URL == nil {
		return
	}
	if req.URL.Scheme == "" {
		if port == "443" {
			req.URL.Scheme = "https"
		} else {
			req.URL.Scheme = "http"
		}
	}
	if req.URL.Host == "" {
		req.URL.Host = host
		if port != "80" && port != "443" {
			req.URL.Host = net.JoinHostPort(host, port)
		}
	}
	req.RequestURI = ""
}

func (s *Server) doSNIRewrite(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.RequestURI = ""
	tr := &http.Transport{
		Proxy: nil,
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialer := &net.Dialer{
				Timeout:   time.Duration(s.cfg.TCPConnectTimeout) * time.Second,
				KeepAlive: 30 * time.Second,
			}
			raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(s.cfg.GoogleIP, "443"))
			if err != nil {
				return nil, err
			}
			tc := tls.Client(raw, &tls.Config{
				ServerName: clone.URL.Hostname(),
				MinVersion: tls.VersionTLS12,
				NextProtos: []string{"h2", "http/1.1"},
			})
			if err := tc.HandshakeContext(ctx); err != nil {
				_ = raw.Close()
				return nil, err
			}
			return tc, nil
		},
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: time.Duration(s.cfg.TLSConnectTimeout) * time.Second,
	}
	client := &http.Client{Transport: tr, Timeout: time.Duration(s.cfg.RelayTimeout) * time.Second}
	return client.Do(clone)
}

func (s *Server) directTunnel(target string, client net.Conn, buffered *bufio.Reader) {
	defer client.Close()
	upstream, err := net.DialTimeout("tcp", target, time.Duration(s.cfg.TCPConnectTimeout)*time.Second)
	if err != nil {
		s.logs.Add(obs.LevelWarn, "direct", "dial "+target+" failed: "+err.Error())
		return
	}
	defer upstream.Close()
	errc := make(chan error, 2)
	go func() {
		if buffered != nil && buffered.Buffered() > 0 {
			_, _ = buffered.WriteTo(upstream)
		}
		_, err := io.Copy(upstream, client)
		errc <- err
	}()
	go func() {
		_, err := io.Copy(client, upstream)
		errc <- err
	}()
	<-errc
}

func writeHTTPResponse(w http.ResponseWriter, resp *http.Response, origin string) {
	for key, values := range resp.Header {
		if strings.HasPrefix(strings.ToLower(key), "access-control-") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if origin != "" {
		injectCORS(w.Header(), origin)
	}
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = io.Copy(w, resp.Body)
}

func corsPreflightResponse(req *http.Request) *http.Response {
	origin := req.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	header := http.Header{}
	header.Set("Access-Control-Allow-Origin", origin)
	header.Set("Access-Control-Allow-Methods", req.Header.Get("Access-Control-Request-Method"))
	header.Set("Access-Control-Allow-Headers", req.Header.Get("Access-Control-Request-Headers"))
	header.Set("Access-Control-Allow-Credentials", "true")
	header.Set("Access-Control-Max-Age", "86400")
	header.Set("Vary", "Origin")
	return &http.Response{
		StatusCode:    http.StatusNoContent,
		Status:        "204 No Content",
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(nil)),
		ContentLength: 0,
		Request:       req,
	}
}

func injectCORS(h http.Header, origin string) {
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "*")
	h.Set("Access-Control-Expose-Headers", "*")
	h.Set("Vary", "Origin")
}

func errorResponse(req *http.Request, err error, status int) *http.Response {
	body := []byte(err.Error() + "\n")
	return &http.Response{
		StatusCode:    status,
		Status:        strconv.Itoa(status) + " " + http.StatusText(status),
		Header:        http.Header{"Content-Type": []string{"text/plain; charset=utf-8"}, "Content-Length": []string{strconv.Itoa(len(body))}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}
}

func splitHostPortDefault(value, defaultPort string) (string, string, error) {
	if value == "" {
		return "", "", fmt.Errorf("empty host")
	}
	if strings.Contains(value, ":") {
		host, port, err := net.SplitHostPort(value)
		if err == nil {
			return strings.Trim(host, "[]"), port, nil
		}
		if strings.Count(value, ":") == 1 {
			parts := strings.Split(value, ":")
			return parts[0], parts[1], nil
		}
	}
	return strings.Trim(value, "[]"), defaultPort, nil
}

func shouldClose(h http.Header) bool {
	return strings.EqualFold(h.Get("Connection"), "close")
}

func requestContentLength(req *http.Request) int64 {
	if req == nil || req.ContentLength < 0 {
		return 0
	}
	return req.ContentLength
}
