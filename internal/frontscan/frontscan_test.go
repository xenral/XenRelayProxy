package frontscan

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"sort"
	"testing"
	"time"
)

func selfSignedTLSConfig(t *testing.T, host string) *tls.Config {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: host},
		DNSNames:              []string{host},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	return &tls.Config{Certificates: []tls.Certificate{cert}}
}

func startTestTLS(t *testing.T) (host, port string, stop func()) {
	t.Helper()
	cfg := selfSignedTLSConfig(t, "scan.local")
	ln, err := tls.Listen("tcp", "127.0.0.1:0", cfg)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				if tlsc, ok := c.(*tls.Conn); ok {
					_ = tlsc.Handshake()
				}
				_ = c.Close()
			}(conn)
		}
	}()
	host, port, _ = net.SplitHostPort(ln.Addr().String())
	return host, port, func() {
		_ = ln.Close()
		<-done
	}
}

func clientCfg() *tls.Config {
	return &tls.Config{ServerName: "scan.local", InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}
}

func TestProbeReachableEndpoint(t *testing.T) {
	host, port, stop := startTestTLS(t)
	defer stop()

	res := probeWithConfig(context.Background(), host, port, clientCfg())
	if !res.OK {
		t.Fatalf("probe failed: %v", res.Error)
	}
	if res.RTTMS <= 0 {
		t.Fatalf("rtt should be >0, got %v", res.RTTMS)
	}
}

func TestProbeUnreachableEndpoint(t *testing.T) {
	res := probeWithConfig(context.Background(), "127.0.0.1", "1", clientCfg())
	if res.OK {
		t.Fatal("expected unreachable, got OK")
	}
	if res.Error == "" {
		t.Fatal("expected error message")
	}
}

func TestResultsSortByOKThenLatency(t *testing.T) {
	results := []Result{
		{IP: "slow", OK: true, RTTMS: 200},
		{IP: "down", OK: false, Error: "refused"},
		{IP: "fast", OK: true, RTTMS: 5},
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].OK != results[j].OK {
			return results[i].OK
		}
		return results[i].RTTMS < results[j].RTTMS
	})
	if results[0].IP != "fast" || results[1].IP != "slow" || results[2].IP != "down" {
		t.Fatalf("unexpected order: %#v", results)
	}
}

func TestCandidateIPsNonEmpty(t *testing.T) {
	if len(CandidateIPs) == 0 {
		t.Fatal("CandidateIPs is empty")
	}
}
