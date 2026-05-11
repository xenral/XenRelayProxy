package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

// vercelTestClient wires a Client where the only enabled account is in
// vercel mode and points at the supplied test server. The Apps Script
// provider is constructed too (so cfg.Mode can be flipped if a test
// wants), but the per-account Provider override forces dispatch to the
// Vercel path regardless.
func vercelTestClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	cfg := config.Config{
		Mode:                 config.ModeVercel,
		GoogleIP:             "127.0.0.1",
		FrontDomain:          "www.google.com",
		AuthKey:              "secret",
		RelayTimeout:         5,
		TCPConnectTimeout:    5,
		TLSConnectTimeout:    5,
		MaxRequestBodyBytes:  1024 * 1024,
		MaxResponseBodyBytes: 1024 * 1024,
		Accounts: []config.Account{{
			Label:      "v",
			Provider:   config.ModeVercel,
			VercelURL:  srv.URL,
			Enabled:    true,
			Weight:     1,
			DailyQuota: 100,
		}},
		Scheduler: config.Scheduler{
			Strategy:                    "least_loaded",
			CooloffSeconds:              900,
			ThrottleBackoffSeconds:      60,
			QuotaSafetyMargin:           0.95,
			StatePersistIntervalSeconds: 30,
		},
	}
	s := scheduler.New(cfg.Accounts, cfg.Scheduler)
	return NewClient(cfg, s, obs.NewMetrics(), nil)
}

func TestVercelSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tunnel" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("X-Relay-Token") != "secret" {
			t.Fatalf("missing or wrong X-Relay-Token: %q", r.Header.Get("X-Relay-Token"))
		}
		var env protocol.Envelope
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			t.Fatal(err)
		}
		if env.U != "https://example.com/" {
			t.Fatalf("bad envelope URL: %s", env.U)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"s": 200,
			"h": map[string]string{"content-type": "text/plain"},
			"b": base64.StdEncoding.EncodeToString([]byte("ok")),
		})
	}))
	defer srv.Close()
	c := vercelTestClient(t, srv)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	resp, err := c.Do(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestVercelTokenMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"e":"unauthorized"}`))
	}))
	defer srv.Close()
	c := vercelTestClient(t, srv)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	_, err := c.Do(context.Background(), req)
	if err == nil {
		t.Fatal("expected auth error")
	}
	if class := ClassifyError(err); class != ErrorAuth {
		t.Fatalf("expected auth class, got %s (%v)", class, err)
	}
}

func TestVercelTooLarge(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"e":    "too_large",
			"size": int64(50 * 1024 * 1024),
			"h":    map[string]string{"content-length": "52428800"},
		})
	}))
	defer srv.Close()
	c := vercelTestClient(t, srv)
	req, _ := http.NewRequest("GET", "https://example.com/big.zip", nil)
	_, err := c.Do(context.Background(), req)
	if err == nil {
		t.Fatal("expected too_large error")
	}
	var tle *protocol.TooLargeError
	if !errors.As(err, &tle) {
		t.Fatalf("expected *protocol.TooLargeError, got %T (%v)", err, err)
	}
	if tle.Size != 50*1024*1024 {
		t.Fatalf("expected size 50MiB, got %d", tle.Size)
	}
}

func TestVercelBatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/batch" {
			t.Fatalf("unexpected batch path: %s", r.URL.Path)
		}
		var env protocol.Envelope
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			t.Fatal(err)
		}
		if len(env.Q) != 2 {
			t.Fatalf("expected 2 envelopes, got %d", len(env.Q))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"r": []map[string]any{
				{"s": 200, "h": map[string]string{}, "b": base64.StdEncoding.EncodeToString([]byte("a"))},
				{"s": 201, "h": map[string]string{}, "b": base64.StdEncoding.EncodeToString([]byte("b"))},
			},
		})
	}))
	defer srv.Close()
	c := vercelTestClient(t, srv)
	r1, _ := http.NewRequest("GET", "https://example.com/1", nil)
	r2, _ := http.NewRequest("GET", "https://example.com/2", nil)
	resps, err := c.DoBatch(context.Background(), []*http.Request{r1, r2})
	if err != nil {
		t.Fatal(err)
	}
	if len(resps) != 2 || resps[0].StatusCode != 200 || resps[1].StatusCode != 201 {
		t.Fatalf("bad batch responses: %v", resps)
	}
}

func TestVercelOversizedRequestBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Should never be reached — BuildEnvelope fails first.
		t.Fatal("server should not be hit when request body exceeds cap")
	}))
	defer srv.Close()
	c := vercelTestClient(t, srv)
	c.cfg.MaxRequestBodyBytes = 8
	body := strings.NewReader("more than eight bytes here")
	req, _ := http.NewRequest("POST", "https://example.com/upload", body)
	_, err := c.Do(context.Background(), req)
	if err == nil {
		t.Fatal("expected rejection of oversized request body")
	}
	if !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected 'exceeds' in error, got %v", err)
	}
}

func TestVercelHTMLLandingPage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<!DOCTYPE html><html><body>Vercel</body></html>"))
	}))
	defer srv.Close()
	c := vercelTestClient(t, srv)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	_, err := c.Do(context.Background(), req)
	if err == nil {
		t.Fatal("expected HTML-not-JSON error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "html") {
		t.Fatalf("expected HTML in error, got %v", err)
	}
}
