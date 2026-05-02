package certstore

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"os/exec"
	"runtime"
)

func IsTrusted(certFile string) bool {
	data, err := os.ReadFile(certFile)
	if err != nil {
		return false
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		return false
	}
	_, err = cert.Verify(x509.VerifyOptions{
		Roots:     pool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	})
	return err == nil
}

func Install(certFile string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", certFile).Run()
	case "windows":
		return exec.Command("certutil", "-addstore", "-f", "Root", certFile).Run()
	case "linux":
		target := "/usr/local/share/ca-certificates/xenrelayproxy.crt"
		if err := exec.Command("cp", certFile, target).Run(); err != nil {
			return err
		}
		return exec.Command("update-ca-certificates").Run()
	default:
		return nil
	}
}

func Uninstall(certFile string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("security", "remove-trusted-cert", "-d", certFile).Run()
	case "windows":
		return exec.Command("certutil", "-delstore", "Root", "XenRelayProxy Local MITM Root").Run()
	case "linux":
		_ = os.Remove("/usr/local/share/ca-certificates/xenrelayproxy.crt")
		return exec.Command("update-ca-certificates").Run()
	default:
		return nil
	}
}
