package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/scheduler"
)

func fanoutClient(t *testing.T, handler http.HandlerFunc, scriptIDs []string, fanoutMax, hedgeMs int) *Client {
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
			ScriptIDs:  scriptIDs,
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
			FanoutMax:                   fanoutMax,
			FanoutHedgeDelayMs:          hedgeMs,
		},
	}
	s := scheduler.New(cfg.Accounts, cfg.Scheduler)
	return NewClient(cfg, s, obs.NewMetrics(), nil, WithBaseURL(srv.URL))
}

func okReply(w http.ResponseWriter, payload string) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"s": 200,
		"h": map[string]string{"content-type": "text/plain"},
		"b": base64.StdEncoding.EncodeToString([]byte(payload)),
	})
}

// TestFanoutFirstSuccessWins: with two arms fired in parallel (hedge=0),
// the faster handler should win and the slower one should observe a
// cancelled request context. This is the core latency-win property.
func TestFanoutFirstSuccessWins(t *testing.T) {
	var slowCtxErr atomic.Pointer[error]
	handler := func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("sid") {
		case "fast":
			okReply(w, "fast-win")
		case "slow":
			select {
			case <-time.After(2 * time.Second):
				okReply(w, "slow-win")
			case <-r.Context().Done():
				err := r.Context().Err()
				slowCtxErr.Store(&err)
			}
		}
	}
	c := fanoutClient(t, handler, []string{"fast", "slow"}, 2, 0)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	resp, err := c.Do(context.Background(), req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	// Give the slow handler a moment to observe the cancellation that
	// the winner triggered via the shared raceCtx cancel.
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if slowCtxErr.Load() != nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("slow arm never saw context cancellation")
}

// TestFanoutAllFailReturnsWorstError: when every arm fails, Client.Do
// must report the most consequential class. A 500 body that contains
// "quota" classifies as ErrorQuota; a plain 502 classifies as
// ErrorTransient. Quota outranks Transient → final error should be
// ErrorQuota so the scheduler applies the longest cooloff.
func TestFanoutAllFailReturnsWorstError(t *testing.T) {
	handler := func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("sid") {
		case "quota":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("service invoked too many times for one day"))
		case "transient":
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte("upstream offline"))
		}
	}
	c := fanoutClient(t, handler, []string{"quota", "transient"}, 2, 0)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	_, err := c.Do(context.Background(), req)
	if err == nil {
		t.Fatal("expected error when all arms fail")
	}
	if cls := ClassifyError(err); cls != ErrorQuota {
		t.Fatalf("expected ErrorQuota (highest priority), got %s (err=%v)", cls, err)
	}
}

// TestFanoutHedgeDelayNoFireOnFastSuccess: with a 200ms hedge delay and
// the first arm responding in <10ms, the second arm's goroutine should
// still be waiting in the hedge timer when raceCtx is cancelled —
// resulting in zero HTTP calls to the second deployment. This is the
// "tail at scale" property: fast paths cost nothing extra.
func TestFanoutHedgeDelayNoFireOnFastSuccess(t *testing.T) {
	var slowHits int64
	handler := func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("sid") {
		case "fast":
			okReply(w, "fast")
		case "slow":
			atomic.AddInt64(&slowHits, 1)
			okReply(w, "slow")
		}
	}
	c := fanoutClient(t, handler, []string{"fast", "slow"}, 2, 200)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	resp, err := c.Do(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	// Slow arm must not have fired — its hedge timer was cancelled
	// before it elapsed.
	if got := atomic.LoadInt64(&slowHits); got != 0 {
		t.Fatalf("hedged arm fired despite fast success: %d hits", got)
	}
}

// TestFanoutContextCancelPropagates: when the caller cancels the parent
// context mid-race, every arm must observe cancellation. Verifies the
// race goroutines respect the inherited context, not just the internal
// raceCtx — important so a browser disconnect doesn't leave goroutines
// hammering Apps Script.
func TestFanoutContextCancelPropagates(t *testing.T) {
	var wg sync.WaitGroup
	armsSawCancel := make(chan struct{}, 2)
	wg.Add(2)
	handler := func(w http.ResponseWriter, r *http.Request) {
		defer wg.Done()
		select {
		case <-time.After(2 * time.Second):
			okReply(w, "should-not-arrive")
		case <-r.Context().Done():
			armsSawCancel <- struct{}{}
		}
	}
	c := fanoutClient(t, handler, []string{"a", "b"}, 2, 0)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	if _, err := c.Do(ctx, req); err == nil {
		t.Fatal("expected cancellation error")
	}
	// Wait for both arm goroutines to acknowledge the cancellation.
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(1 * time.Second):
		t.Fatalf("arms never observed cancellation (saw %d of 2)", len(armsSawCancel))
	}
}

// TestFanoutDisabledFallsBackToSingleShot: FanoutMax=1 should be a
// byte-identical to the pre-fanout build — the leased clone has one
// script ID and only one HTTP call hits the server.
func TestFanoutDisabledFallsBackToSingleShot(t *testing.T) {
	var totalHits int64
	handler := func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&totalHits, 1)
		okReply(w, "single")
	}
	c := fanoutClient(t, handler, []string{"a", "b", "c"}, 1, 0)
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	if _, err := c.Do(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt64(&totalHits); got != 1 {
		t.Fatalf("expected exactly 1 hit with FanoutMax=1, got %d", got)
	}
}
