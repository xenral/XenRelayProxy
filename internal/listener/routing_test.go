package listener

import (
	"testing"

	"xenrelayproxy/internal/config"
)

func TestRoutingBypass(t *testing.T) {
	r := NewRouter(config.Config{BypassHosts: []string{"localhost", ".lan"}})
	if !r.ShouldBypass("printer.lan") {
		t.Fatal("expected .lan bypass")
	}
	if !r.ShouldBypass("127.0.0.1") {
		t.Fatal("expected loopback bypass")
	}
}

func TestDirectGoogleExcludeWins(t *testing.T) {
	r := NewRouter(config.Config{
		DirectGoogleAllow:   []string{"google.com"},
		DirectGoogleExclude: []string{"mail.google.com"},
	})
	if r.ShouldDirectGoogle("mail.google.com") {
		t.Fatal("exclude should win")
	}
	if !r.ShouldDirectGoogle("www.google.com") {
		t.Fatal("google.com suffix should match")
	}
}

func TestSNIRewrite(t *testing.T) {
	r := NewRouter(config.Config{SNIRewriteHosts: []string{"youtube.com"}})
	if !r.ShouldSNIRewrite("www.youtube.com") {
		t.Fatal("expected youtube rewrite")
	}
}
