package protocol

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBuildEnvelopeStripsSensitiveHeaders(t *testing.T) {
	req, err := http.NewRequest("POST", "https://example.com/path", strings.NewReader("hello"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-For", "127.0.0.1")
	req.Header.Set("User-Agent", "test")
	req.Header.Set("Content-Type", "text/plain")
	env, err := BuildEnvelope(req, "key", 1024)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := env.H["X-Forwarded-For"]; ok {
		t.Fatal("sensitive header was forwarded")
	}
	if env.H["User-Agent"] != "test" {
		t.Fatalf("missing user-agent: %#v", env.H)
	}
	if env.B == "" || env.CT != "text/plain" {
		t.Fatalf("body metadata not set: %#v", env)
	}
}

func TestParseBatchUsesCleanV2RArray(t *testing.T) {
	replies, err := ParseBatch([]byte(`{"r":[{"s":200,"h":{},"b":""}]}`), 1)
	if err != nil {
		t.Fatal(err)
	}
	if replies[0].S != 200 {
		t.Fatalf("bad status: %#v", replies[0])
	}
	if _, err := ParseBatch([]byte(`{"q":[{"s":200}]}`), 1); err == nil {
		t.Fatal("expected old q response shape to be rejected")
	}
}

func TestResponseFromReply(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	resp, err := ResponseFromReply(req, Reply{
		S: 201,
		H: map[string]string{"content-type": "text/plain"},
		B: "aGk=",
	})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 201 || string(body) != "hi" {
		t.Fatalf("unexpected response: %d %q", resp.StatusCode, string(body))
	}
}
