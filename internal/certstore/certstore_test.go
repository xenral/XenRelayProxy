package certstore

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeSelfSignedCert(t *testing.T, path string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "XenRelayProxy Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(path, pemBytes, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestIsTrustedReturnsFalseForUntrustedCert(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ca.crt")
	writeSelfSignedCert(t, path)
	if IsTrusted(path) {
		t.Fatal("freshly generated CA reported as trusted by system pool")
	}
}

func TestIsTrustedReturnsFalseForMissingFile(t *testing.T) {
	if IsTrusted(filepath.Join(t.TempDir(), "missing.crt")) {
		t.Fatal("missing file reported as trusted")
	}
}

func TestIsTrustedReturnsFalseForInvalidPEM(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.crt")
	if err := os.WriteFile(path, []byte("not a certificate"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsTrusted(path) {
		t.Fatal("garbage file reported as trusted")
	}
}
