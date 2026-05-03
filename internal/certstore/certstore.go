package certstore

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
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
		// Add to the user login keychain — no admin/sudo required.
		// Chrome, Safari, and macOS apps trust it immediately.
		// Firefox uses its own NSS store; use the Certificate screen for manual steps.
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		kc := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
		return exec.Command("security", "add-trusted-cert",
			"-r", "trustRoot",
			"-k", kc,
			certFile,
		).Run()
	case "windows":
		return exec.Command("certutil", "-addstore", "-user", "-f", "Root", certFile).Run()
	case "linux":
		target := "/usr/local/share/ca-certificates/xenrelayproxy.crt"
		if err := copyFile(certFile, target); err != nil {
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
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		kc := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
		return exec.Command("security", "remove-trusted-cert", "-k", kc, certFile).Run()
	case "windows":
		return exec.Command("certutil", "-delstore", "-user", "Root", "XenRelayProxy Local MITM Root").Run()
	case "linux":
		_ = os.Remove("/usr/local/share/ca-certificates/xenrelayproxy.crt")
		return exec.Command("update-ca-certificates").Run()
	default:
		return nil
	}
}

// Reveal opens the directory containing certFile in the platform file manager.
func Reveal(certFile string) error {
	dir := filepath.Dir(certFile)
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", dir).Run()
	case "windows":
		return exec.Command("explorer", dir).Run()
	default:
		return exec.Command("xdg-open", dir).Run()
	}
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o644)
}
