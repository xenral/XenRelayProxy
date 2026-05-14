package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/scheduler"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	cfg := config.Config{
		GoogleIP:             "127.0.0.1",
		FrontDomain:          "www.google.com",
		AuthKey:              "secret",
		RelayTimeout:         5,
		TCPConnectTimeout:    5,
		TLSConnectTimeout:    5,
		MaxRequestBodyBytes:  1024 * 1024,
		MaxResponseBodyBytes: 1024 * 1024,
		Accounts: []config.Account{{
			Label:      "a",
			ScriptIDs:  []string{"sid"},
			Enabled:    true,
			Weight:     1,
			DailyQuota: 100,
		}},
		Scheduler: config.Scheduler{
			Strategy:                    "least_loaded",
			CooloffSeconds:              900,
			ThrottleBackoffSeconds:      60,
			QuotaSafetyMargin:           0.95,
			StateFile:                   "",
			StatePersistIntervalSeconds: 30,
		},
	}
	s := scheduler.New(cfg.Accounts, cfg.Scheduler)
	return NewClient(cfg, s, obs.NewMetrics(), nil, WithBaseURL(srv.URL))
}

func TestRelaySuccess(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["k"] != "secret" {
			t.Fatalf("bad key: %#v", payload)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"s": 200,
			"h": map[string]string{"content-type": "text/plain"},
			"b": base64.StdEncoding.EncodeToString([]byte("ok")),
		})
	})
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	resp, err := c.Do(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestRelayAuthError(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"e": "unauthorized"})
	})
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	_, err := c.Do(context.Background(), req)
	if err == nil || ClassifyError(err) != ErrorAuth {
		t.Fatalf("expected auth error, got %v class %s", err, ClassifyError(err))
	}
}

func TestBatchCleanProtocol(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"r": []map[string]any{{
				"s": 200,
				"h": map[string]string{},
				"b": base64.StdEncoding.EncodeToString([]byte("ok")),
			}},
		})
	})
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	resp, err := c.DoBatch(context.Background(), []*http.Request{req})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp) != 1 || resp[0].StatusCode != 200 {
		t.Fatalf("bad batch: %#v", resp)
	}
}

func TestClassifyQuota(t *testing.T) {
	if got := ClassifyError(errors.New("quota exceeded")); got != ErrorQuota {
		t.Fatalf("expected quota, got %s", got)
	}
}

// TestRetryFailsOverToHealthyAccount: retry must kick in when the first
// account hits an *account-scoped* failure (quota / throttle), because
// switching to a different account's quota pool can plausibly succeed.
// The bad sid here returns a throttle marker; the loop must Release,
// exclude that label, re-Select, and succeed against the healthy
// account. Transient 5xx is deliberately NOT in the retry set — see
// the long-form comment in Client.Do.
func TestRetryFailsOverToHealthyAccount(t *testing.T) {
	var hits struct {
		bad  atomic.Int64
		good atomic.Int64
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("sid") {
		case "sid_bad":
			hits.bad.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("rate limit exceeded"))
		case "sid_good":
			hits.good.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"s": 200,
				"h": map[string]string{"content-type": "text/plain"},
				"b": base64.StdEncoding.EncodeToString([]byte("ok")),
			})
		default:
			t.Errorf("unexpected sid %q", r.URL.Query().Get("sid"))
		}
	}))
	t.Cleanup(srv.Close)
	cfg := config.Config{
		GoogleIP:             "127.0.0.1",
		FrontDomain:          "www.google.com",
		AuthKey:              "secret",
		RelayTimeout:         5,
		TCPConnectTimeout:    5,
		TLSConnectTimeout:    5,
		MaxRequestBodyBytes:  1024 * 1024,
		MaxResponseBodyBytes: 1024 * 1024,
		// Order matters: round_robin picks "bad" first so the retry has
		// to flip over to "good". With least_loaded the tie-breaker is
		// non-deterministic on a fresh scheduler.
		Accounts: []config.Account{
			{Label: "bad", ScriptIDs: []string{"sid_bad"}, Enabled: true, Weight: 1, DailyQuota: 100},
			{Label: "good", ScriptIDs: []string{"sid_good"}, Enabled: true, Weight: 1, DailyQuota: 100},
		},
		Scheduler: config.Scheduler{
			Strategy:                    "round_robin",
			CooloffSeconds:              900,
			ThrottleBackoffSeconds:      60,
			QuotaSafetyMargin:           0.95,
			StatePersistIntervalSeconds: 30,
			AccountMaxInFlight:          10,
			RetryMaxAttempts:            2,
		},
	}
	s := scheduler.New(cfg.Accounts, cfg.Scheduler)
	c := NewClient(cfg, s, obs.NewMetrics(), nil, WithBaseURL(srv.URL))
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	resp, err := c.Do(context.Background(), req)
	if err != nil {
		t.Fatalf("expected retry to succeed against good account, got %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if hits.bad.Load() < 1 {
		t.Fatalf("bad account never hit (no retry happened)")
	}
	if hits.good.Load() != 1 {
		t.Fatalf("good account expected exactly 1 hit, got %d", hits.good.Load())
	}
	// Both accounts must end with in-flight back to 0 — Release ran on
	// both paths. A leak here would slowly saturate the per-account cap.
	for _, acct := range s.AllAccounts() {
		if acct.InFlight() != 0 {
			t.Fatalf("account %s leaked in-flight: %d", acct.Label, acct.InFlight())
		}
	}
}

// TestRetryGivesUpOnAuthError: auth errors mean the deployment is
// misconfigured (wrong access settings or bad auth key); re-picking
// another account cannot help, so the loop must short-circuit instead
// of burning the entire retry budget against the same problem.
func TestRetryGivesUpOnAuthError(t *testing.T) {
	var totalHits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		totalHits.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("unauthorized"))
	}))
	t.Cleanup(srv.Close)
	cfg := config.Config{
		GoogleIP:             "127.0.0.1",
		FrontDomain:          "www.google.com",
		AuthKey:              "secret",
		RelayTimeout:         5,
		TCPConnectTimeout:    5,
		TLSConnectTimeout:    5,
		MaxRequestBodyBytes:  1024 * 1024,
		MaxResponseBodyBytes: 1024 * 1024,
		Accounts: []config.Account{
			{Label: "a", ScriptIDs: []string{"sid_a"}, Enabled: true, Weight: 1, DailyQuota: 100},
			{Label: "b", ScriptIDs: []string{"sid_b"}, Enabled: true, Weight: 1, DailyQuota: 100},
		},
		Scheduler: config.Scheduler{
			Strategy:                    "round_robin",
			CooloffSeconds:              900,
			ThrottleBackoffSeconds:      60,
			QuotaSafetyMargin:           0.95,
			StatePersistIntervalSeconds: 30,
			AccountMaxInFlight:          10,
			RetryMaxAttempts:            3,
		},
	}
	s := scheduler.New(cfg.Accounts, cfg.Scheduler)
	c := NewClient(cfg, s, obs.NewMetrics(), nil, WithBaseURL(srv.URL))
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	_, err := c.Do(context.Background(), req)
	if err == nil || ClassifyError(err) != ErrorAuth {
		t.Fatalf("expected auth error, got %v (class %s)", err, ClassifyError(err))
	}
	if got := totalHits.Load(); got != 1 {
		t.Fatalf("expected exactly 1 hit (no retry on auth), got %d", got)
	}
}
