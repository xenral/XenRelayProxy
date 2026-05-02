package cache

import (
	"net/http"
	"testing"
	"time"
)

func TestTTLStaticAsset(t *testing.T) {
	resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{}}
	if ttl := TTL(resp, "https://example.com/app.css"); ttl != 30*time.Minute {
		t.Fatalf("unexpected ttl: %s", ttl)
	}
}

func TestTTLNoStore(t *testing.T) {
	resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Cache-Control": []string{"no-store"}}}
	if ttl := TTL(resp, "https://example.com/app.css"); ttl != 0 {
		t.Fatalf("expected no cache, got %s", ttl)
	}
}

func TestPutGet(t *testing.T) {
	c := New(1024)
	resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/plain"}}}
	c.Put("k", resp, []byte("hello"), time.Minute)
	got, ok := c.Get("k")
	if !ok {
		t.Fatal("cache miss")
	}
	if got.Header.Get("Content-Type") != "text/plain" {
		t.Fatalf("bad headers: %#v", got.Header)
	}
}
