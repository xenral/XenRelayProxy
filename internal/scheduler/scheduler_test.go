package scheduler

import (
	"path/filepath"
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
