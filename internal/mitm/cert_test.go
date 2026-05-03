package mitm

import (
	"crypto/ecdsa"
	"crypto/tls"
	"crypto/x509"
	"path/filepath"
	"testing"
	"time"
)

func newManager(t *testing.T) *Manager {
	t.Helper()
	dir := t.TempDir()
	mgr, err := NewManager(filepath.Join(dir, "ca.crt"), filepath.Join(dir, "ca.key"))
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func TestNewManagerCreatesCA(t *testing.T) {
	mgr := newManager(t)
	if mgr.caCert == nil || mgr.caKey == nil {
		t.Fatal("CA not created")
	}
	if !mgr.caCert.IsCA {
		t.Fatal("CA cert is not marked as CA")
	}
	if mgr.FingerprintSHA256() == "" {
		t.Fatal("fingerprint empty")
	}
}

func TestLoadExistingCA(t *testing.T) {
	dir := t.TempDir()
	cert := filepath.Join(dir, "ca.crt")
	key := filepath.Join(dir, "ca.key")
	first, err := NewManager(cert, key)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	second, err := NewManager(cert, key)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if first.FingerprintSHA256() != second.FingerprintSHA256() {
		t.Fatalf("CA fingerprint changed across reload")
	}
}

func TestCertificateForDNSHost(t *testing.T) {
	mgr := newManager(t)
	cert, err := mgr.CertificateFor("example.com")
	if err != nil {
		t.Fatalf("CertificateFor: %v", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	if leaf.Subject.CommonName != "example.com" {
		t.Fatalf("CN = %q want example.com", leaf.Subject.CommonName)
	}
	if len(leaf.DNSNames) != 1 || leaf.DNSNames[0] != "example.com" {
		t.Fatalf("DNS SANs = %v", leaf.DNSNames)
	}
	if _, ok := leaf.PublicKey.(*ecdsa.PublicKey); !ok {
		t.Fatalf("expected ECDSA leaf, got %T", leaf.PublicKey)
	}
	if !leaf.NotAfter.After(time.Now().Add(80 * 24 * time.Hour)) {
		t.Fatalf("leaf valid only until %v", leaf.NotAfter)
	}
}

func TestCertificateForIPHost(t *testing.T) {
	mgr := newManager(t)
	cert, err := mgr.CertificateFor("10.0.0.1")
	if err != nil {
		t.Fatalf("CertificateFor: %v", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	if len(leaf.IPAddresses) != 1 {
		t.Fatalf("expected IP SAN, got %v", leaf.IPAddresses)
	}
	if leaf.IPAddresses[0].String() != "10.0.0.1" {
		t.Fatalf("IP SAN = %v", leaf.IPAddresses)
	}
}

func TestCertificateCacheReturnsSameInstance(t *testing.T) {
	mgr := newManager(t)
	a, err := mgr.CertificateFor("cache.test")
	if err != nil {
		t.Fatal(err)
	}
	b, err := mgr.CertificateFor("cache.test")
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatal("cache miss: separate instances returned for same host")
	}
}

func TestLeafSignedByCA(t *testing.T) {
	mgr := newManager(t)
	cert, err := mgr.CertificateFor("verify.test")
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(mgr.caCert)
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:     pool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSName:   "verify.test",
	}); err != nil {
		t.Fatalf("verify failed: %v", err)
	}
}

func TestServerTLSConfigUsesLeaf(t *testing.T) {
	mgr := newManager(t)
	cfg, err := mgr.ServerTLSConfig("tls.test")
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Certificates) != 1 {
		t.Fatalf("expected one cert, got %d", len(cfg.Certificates))
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Fatalf("MinVersion = %x", cfg.MinVersion)
	}
}
