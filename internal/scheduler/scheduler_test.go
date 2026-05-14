package scheduler

import (
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"xenrelayproxy/internal/config"
)

func accounts(labels ...string) []config.Account {
	out := make([]config.Account, 0, len(labels))
	for _, label := range labels {
		out = append(out, config.Account{
			Label:       label,
			ScriptIDs:   []string{"sid_" + label},
			AccountType: "consumer",
			Enabled:     true,
			Weight:      1,
			DailyQuota:  100,
		})
	}
	return out
}

func schedCfg(t *testing.T) config.Scheduler {
	return config.Scheduler{
		Strategy:                    "least_loaded",
		CooloffSeconds:              900,
		ThrottleBackoffSeconds:      1,
		QuotaSafetyMargin:           0.95,
		StateFile:                   filepath.Join(t.TempDir(), "state.json"),
		StatePersistIntervalSeconds: 3600,
		KeepaliveIntervalSeconds:    180,
		PrewarmOnStart:              true,
	}
}

func TestSelectSingleAccount(t *testing.T) {
	s := New(accounts("a"), schedCfg(t))
	a, err := s.Select()
	if err != nil {
		t.Fatal(err)
	}
	if a.Label != "a" {
		t.Fatalf("selected %s", a.Label)
	}
}

func TestSafetyMarginExcludesAccount(t *testing.T) {
	cfg := schedCfg(t)
	cfg.QuotaSafetyMargin = 0.5
	s := New(accounts("a", "b"), cfg)
	s.accounts[0].CallsToday = 50
	a, err := s.Select()
	if err != nil {
		t.Fatal(err)
	}
	if a.Label != "b" {
		t.Fatalf("selected %s", a.Label)
	}
}

func TestAllCooledOff(t *testing.T) {
	s := New(accounts("a"), schedCfg(t))
	s.accounts[0].CooloffUntil = time.Now().Add(time.Minute)
	if _, err := s.Select(); err != ErrNoAccountAvailable {
		t.Fatalf("expected ErrNoAccountAvailable, got %v", err)
	}
}

func TestReportSuccessResetsErrors(t *testing.T) {
	s := New(accounts("a"), schedCfg(t))
	a, _ := s.Select()
	s.ReportError(a)
	s.ReportError(a)
	s.ReportSuccess(a, 100*time.Millisecond)
	stats := s.Stats()
	if stats.Accounts[0].ConsecutiveErrors != 0 {
		t.Fatalf("errors not reset: %#v", stats.Accounts[0])
	}
	if stats.Accounts[0].CallsToday != 1 {
		t.Fatalf("calls not incremented: %#v", stats.Accounts[0])
	}
}

func TestPickScriptIDsAdvancesIndex(t *testing.T) {
	a := &Account{ScriptIDs: []string{"s1", "s2", "s3"}}
	got := a.PickScriptIDs(2)
	if len(got) != 2 || got[0] != "s1" || got[1] != "s2" {
		t.Fatalf("first pick: %v", got)
	}
	got = a.PickScriptIDs(2)
	if len(got) != 2 || got[0] != "s3" || got[1] != "s1" {
		t.Fatalf("second pick (should wrap): %v", got)
	}
	// n larger than len caps to len.
	got = a.PickScriptIDs(10)
	if len(got) != 3 {
		t.Fatalf("expected 3 IDs (capped), got %d: %v", len(got), got)
	}
}

func TestCloneLeasedAccountFanout(t *testing.T) {
	a := &Account{Label: "x", ScriptIDs: []string{"s1", "s2", "s3"}, Enabled: true}
	cp := cloneLeasedAccountFanout(a, 2)
	if len(cp.ScriptIDs) != 2 {
		t.Fatalf("expected 2 script IDs on clone, got %v", cp.ScriptIDs)
	}
	if cp.Label != "x" {
		t.Fatalf("label not preserved: %s", cp.Label)
	}
	// Single-ID path (n=1) must collapse to one ID for backwards-compat.
	cp2 := cloneLeasedAccountFanout(a, 1)
	if len(cp2.ScriptIDs) != 1 {
		t.Fatalf("n=1 should collapse to single ID, got %v", cp2.ScriptIDs)
	}
}

func TestSelectWithFanoutReturnsMultipleIDs(t *testing.T) {
	cfg := schedCfg(t)
	cfg.FanoutMax = 2
	accs := []config.Account{{
		Label:       "multi",
		ScriptIDs:   []string{"s1", "s2", "s3"},
		AccountType: "consumer",
		Enabled:     true,
		Weight:      1,
		DailyQuota:  100,
	}}
	s := New(accs, cfg)
	a, err := s.Select()
	if err != nil {
		t.Fatal(err)
	}
	if len(a.ScriptIDs) != 2 {
		t.Fatalf("expected leased clone to expose 2 script IDs with FanoutMax=2, got %v", a.ScriptIDs)
	}
}

// TestSelectIncrementsInFlightAndReleaseDecrements: the core invariant of
// per-account concurrency tracking. A successful Select bumps in-flight
// on the underlying scheduler account (not the returned clone). Release
// returns the slot. If this regresses, every other in-flight protection
// (cap filtering, biased selection) silently breaks too.
func TestSelectIncrementsInFlightAndReleaseDecrements(t *testing.T) {
	s := New(accounts("a"), schedCfg(t))
	a, err := s.Select()
	if err != nil {
		t.Fatal(err)
	}
	if got := s.accounts[0].InFlight(); got != 1 {
		t.Fatalf("expected in-flight 1 after Select, got %d", got)
	}
	s.Release(a)
	if got := s.accounts[0].InFlight(); got != 0 {
		t.Fatalf("expected in-flight 0 after Release, got %d", got)
	}
}

// TestInFlightCapExcludesSaturatedAccount: with maxInFlight=2 and the
// only account already saturated, Select must return
// ErrNoAccountAvailable rather than oversubscribing it past Google's
// concurrent-execution cap.
func TestInFlightCapExcludesSaturatedAccount(t *testing.T) {
	cfg := schedCfg(t)
	cfg.AccountMaxInFlight = 2
	s := New(accounts("a"), cfg)
	if _, err := s.Select(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Select(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Select(); err != ErrNoAccountAvailable {
		t.Fatalf("expected ErrNoAccountAvailable when cap reached, got %v", err)
	}
}

// TestSelectExcludingSkipsLabel: SelectExcluding is the retry primitive.
// When an account has just failed, the relay client passes its label in
// `excluded` and SelectExcluding must skip it even though it is otherwise
// eligible. With only one matching account that means ErrNoAccountAvailable.
func TestSelectExcludingSkipsLabel(t *testing.T) {
	s := New(accounts("a", "b"), schedCfg(t))
	a, err := s.SelectExcluding([]string{"a"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Label != "b" {
		t.Fatalf("expected b (a excluded), got %s", a.Label)
	}
	s.Release(a)
	// Exclude both → no account should remain.
	if _, err := s.SelectExcluding([]string{"a", "b"}); err != ErrNoAccountAvailable {
		t.Fatalf("expected ErrNoAccountAvailable with both excluded, got %v", err)
	}
}

// TestBiasedSelectionPrefersLessLoaded: when two accounts have identical
// daily-quota usage, the one with more in-flight requests should lose to
// the one with fewer. This is the real-time spread that prevents a single
// account from soaking up bursts while siblings sit idle. Without this
// bias the scheduler would keep picking the same account until quota
// caught up — which under burst load means hitting Google's concurrent
// cap before quota does.
func TestBiasedSelectionPrefersLessLoaded(t *testing.T) {
	cfg := schedCfg(t)
	cfg.AccountMaxInFlight = 10
	s := New(accounts("a", "b"), cfg)
	// Force account "a" to look heavily loaded by parking 5 in-flight on
	// it directly. Both accounts have CallsToday=0, so usage_ratio ties.
	atomic.AddInt64(&s.accounts[0].inFlight, 5)
	picked, err := s.Select()
	if err != nil {
		t.Fatal(err)
	}
	if picked.Label != "b" {
		t.Fatalf("expected biased selection to pick b (idle), got %s", picked.Label)
	}
}

func TestStateRoundTrip(t *testing.T) {
	cfg := schedCfg(t)
	s1 := New(accounts("a"), cfg)
	s1.accounts[0].CallsToday = 42
	s1.accounts[0].TotalCalls = 100
	if err := s1.SaveState(); err != nil {
		t.Fatal(err)
	}
	s2 := New(accounts("a"), cfg)
	if err := s2.LoadState(); err != nil {
		t.Fatal(err)
	}
	stats := s2.Stats()
	if stats.Accounts[0].CallsToday != 42 || stats.Accounts[0].TotalCalls != 100 {
		t.Fatalf("state not restored: %#v", stats.Accounts[0])
	}
}
