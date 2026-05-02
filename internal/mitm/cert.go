package mitm

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultCADir      = "ca"
	DefaultCACertFile = "ca/ca.crt"
	DefaultCAKeyFile  = "ca/ca.key"
	caCommonName      = "XenRelayProxy Local MITM Root"
	leafValidity      = 90 * 24 * time.Hour
	caValidity        = 10 * 365 * 24 * time.Hour
	rsaKeyBits        = 2048
)

type Manager struct {
	mu       sync.Mutex
	certFile string
	keyFile  string
	caCert   *x509.Certificate
	caKey    *rsa.PrivateKey
	cache    map[string]*tls.Certificate
}

func NewManager(certFile, keyFile string) (*Manager, error) {
	if certFile == "" {
		certFile = DefaultCACertFile
	}
	if keyFile == "" {
		keyFile = DefaultCAKeyFile
	}
	m := &Manager{certFile: certFile, keyFile: keyFile, cache: map[string]*tls.Certificate{}}
	if err := m.loadOrCreateCA(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) CACertFile() string { return m.certFile }

func (m *Manager) ServerTLSConfig(host string) (*tls.Config, error) {
	cert, err := m.CertificateFor(host)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{*cert},
		MinVersion:   tls.VersionTLS12,
		NextProtos:   []string{"http/1.1"},
	}, nil
}

func (m *Manager) CertificateFor(host string) (*tls.Certificate, error) {
	host = cleanHost(host)
	if host == "" {
		return nil, fmt.Errorf("empty host")
	}
	m.mu.Lock()
	if cert := m.cache[host]; cert != nil {
		m.mu.Unlock()
		return cert, nil
	}
	m.mu.Unlock()

	key, err := rsa.GenerateKey(rand.Reader, rsaKeyBits)
	if err != nil {
		return nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, err
	}
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: host,
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(leafValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	if ip := net.ParseIP(host); ip != nil {
		template.IPAddresses = []net.IP{ip}
	} else {
		template.DNSNames = []string{host}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, m.caCert, &key.PublicKey, m.caKey)
	if err != nil {
		return nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	tlsCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.cache[host] = &tlsCert
	m.mu.Unlock()
	return &tlsCert, nil
}

func (m *Manager) FingerprintSHA256() string {
	if m.caCert == nil {
		return ""
	}
	sum := sha256.Sum256(m.caCert.Raw)
	return fmt.Sprintf("%X", sum[:])
}

func (m *Manager) loadOrCreateCA() error {
	certPEM, certErr := os.ReadFile(m.certFile)
	keyPEM, keyErr := os.ReadFile(m.keyFile)
	if certErr == nil && keyErr == nil {
		certBlock, _ := pem.Decode(certPEM)
		keyBlock, _ := pem.Decode(keyPEM)
		if certBlock == nil || keyBlock == nil {
			return fmt.Errorf("invalid CA PEM files")
		}
		cert, err := x509.ParseCertificate(certBlock.Bytes)
		if err != nil {
			return err
		}
		key, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
		if err != nil {
			return err
		}
		m.caCert = cert
		m.caKey = key
		return nil
	}
	return m.createCA()
}

func (m *Manager) createCA() error {
	if err := os.MkdirAll(filepath.Dir(m.certFile), 0o700); err != nil {
		return err
	}
	key, err := rsa.GenerateKey(rand.Reader, rsaKeyBits)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   caCommonName,
			Organization: []string{"XenRelayProxy"},
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(caValidity),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if err := os.WriteFile(m.certFile, certPEM, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(m.keyFile, keyPEM, 0o600); err != nil {
		return err
	}
	m.caCert, err = x509.ParseCertificate(der)
	if err != nil {
		return err
	}
	m.caKey = key
	return nil
}

func cleanHost(host string) string {
	host = strings.TrimSpace(strings.ToLower(host))
	host = strings.TrimSuffix(host, ".")
	if strings.Contains(host, ":") {
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
	}
	return strings.Trim(host, "[]")
}
