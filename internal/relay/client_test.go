package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
