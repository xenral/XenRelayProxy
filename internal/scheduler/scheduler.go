package scheduler

import (
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"xenrelayproxy/internal/config"
)

var ErrNoAccountAvailable = errors.New("no relay account available")

// DefaultAccountMaxInFlight caps concurrent in-flight requests per account
// when scheduler.account_max_in_flight is unset. Apps Script has an
// undocumented ~30 concurrent execution cap per *script project* shared
// across all of its deployments, so 20 leaves headroom for keepalives,
// fan-out arms that haven't been cancelled yet, and bursty re-tries.
const DefaultAccountMaxInFlight = 20

type Account struct {
	Label             string    `json:"label"`
	Email             string    `json:"email,omitempty"`
	ScriptIDs         []string  `json:"script_ids"`
	AccountType       string    `json:"account_type"`
	Enabled           bool      `json:"enabled"`
	Weight            float64   `json:"weight"`
	DailyQuota        int       `json:"daily_quota"`
	Provider          string    `json:"provider,omitempty"`
	VercelURL         string    `json:"vercel_url,omitempty"`
	CallsToday        int       `json:"calls_today"`
	QuotaWindowStart  time.Time `json:"quota_window_start"`
	ConsecutiveErrors int       `json:"consecutive_errors"`
	CooloffUntil      time.Time `json:"cooloff_until"`
	LastSuccessAt     time.Time `json:"last_success_at"`
	LastKeepaliveAt   time.Time `json:"last_keepalive_at"`
	IsWarm            bool      `json:"is_warm"`
	TotalCalls        int       `json:"total_calls"`
	TotalErrors       int       `json:"total_errors"`

	// inFlight tracks how many requests this account currently has in
	// flight against Apps Script. Mutated via atomic ops from any goroutine
	// (Scheduler.Select increments; Scheduler.Release decrements) so the
	// hot path doesn't need the scheduler mutex. Raw int64 instead of
	// atomic.Int64 keeps the struct copyable (cloneAccount uses *a copy);
	// reads go through atomic.LoadInt64 to stay race-free.
	inFlight int64

	throttleTimestamps []time.Time
	sidIndex           int
}

// InFlight returns the current number of in-flight requests against this
// account. Safe to call concurrently.
func (a *Account) InFlight() int64 { return atomic.LoadInt64(&a.inFlight) }

type Scheduler struct {
	mu                sync.Mutex
	accounts          []*Account
	strategy          string
	cooloff           time.Duration
	throttleBackoff   time.Duration
	quotaSafetyMargin float64
	stateFile         string
	persistInterval   time.Duration
	keepaliveInterval time.Duration
	prewarmOnStart    bool
	fanoutMax         int
	maxInFlight       int
	roundRobinIndex   int
	stopPersist       chan struct{}
	persistStopped    chan struct{}
	random            *rand.Rand
}

type Stats struct {
	Strategy        string         `json:"strategy"`
	TotalDailyQuota int            `json:"total_daily_quota"`
	TotalCallsToday int            `json:"total_calls_today"`
	Accounts        []AccountStats `json:"accounts"`
}

type AccountStats struct {
	Label                   string  `json:"label"`
	Enabled                 bool    `json:"enabled"`
	AccountType             string  `json:"account_type"`
	Deployments             int     `json:"deployments"`
	CallsToday              int     `json:"calls_today"`
	DailyQuota              int     `json:"daily_quota"`
	PercentUsed             float64 `json:"percent_used"`
	CooloffRemainingSeconds float64 `json:"cooloff_remaining_seconds"`
	ConsecutiveErrors       int     `json:"consecutive_errors"`
	IsWarm                  bool    `json:"is_warm"`
	TotalCalls              int     `json:"total_calls"`
	TotalErrors             int     `json:"total_errors"`
	Weight                  float64 `json:"weight"`
	InFlight                int64   `json:"in_flight"`
	MaxInFlight             int     `json:"max_in_flight"`
}

func New(accounts []config.Account, cfg config.Scheduler) *Scheduler {
	now := time.Now()
	fanoutMax := max(cfg.FanoutMax, 1)
	maxInFlight := cfg.AccountMaxInFlight
	if maxInFlight <= 0 {
		maxInFlight = DefaultAccountMaxInFlight
	}
	s := &Scheduler{
		strategy:          cfg.Strategy,
		cooloff:           time.Duration(cfg.CooloffSeconds) * time.Second,
		throttleBackoff:   time.Duration(cfg.ThrottleBackoffSeconds) * time.Second,
		quotaSafetyMargin: cfg.QuotaSafetyMargin,
		stateFile:         cfg.StateFile,
		persistInterval:   time.Duration(cfg.StatePersistIntervalSeconds) * time.Second,
		keepaliveInterval: time.Duration(cfg.KeepaliveIntervalSeconds) * time.Second,
		prewarmOnStart:    cfg.PrewarmOnStart,
		fanoutMax:         fanoutMax,
		maxInFlight:       maxInFlight,
		stopPersist:       make(chan struct{}),
		persistStopped:    make(chan struct{}),
		random:            rand.New(rand.NewSource(now.UnixNano())),
	}
	for _, a := range accounts {
		s.accounts = append(s.accounts, &Account{
			Label:            a.Label,
			Email:            a.Email,
			ScriptIDs:        append([]string(nil), a.ScriptIDs...),
			AccountType:      a.AccountType,
			Enabled:          a.Enabled,
			Weight:           a.Weight,
			DailyQuota:       a.DailyQuota,
			Provider:         a.Provider,
			VercelURL:        a.VercelURL,
			QuotaWindowStart: now,
		})
	}
	return s
}

func (s *Scheduler) Start() error {
	if err := s.LoadState(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	go s.persistLoop()
	return nil
}

func (s *Scheduler) Stop() error {
	close(s.stopPersist)
	<-s.persistStopped
	return s.SaveState()
}

func (s *Scheduler) KeepaliveInterval() time.Duration { return s.keepaliveInterval }
func (s *Scheduler) PrewarmOnStart() bool             { return s.prewarmOnStart }

func (s *Scheduler) Select() (*Account, error) {
	return s.SelectExcluding(nil)
}

// SelectExcluding picks an account whose label is not in `excluded`,
// applying the same eligibility filters as Select. Used by the relay
// retry path to avoid re-picking an account that just failed within the
// same client request. Returns ErrNoAccountAvailable when every eligible
// account is either over its in-flight cap or in the excluded set.
//
// On success the returned (cloned) account has had its real underlying
// InFlight counter incremented by 1; the caller MUST call Release with
// the returned account when the request completes, exactly once.
func (s *Scheduler) SelectExcluding(excluded []string) (*Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.rollWindowsLocked(now)
	maxIF := int64(s.maxInFlight)
	var candidates []*Account
nextAccount:
	for _, a := range s.accounts {
		if !a.Enabled || a.CooloffUntil.After(now) {
			continue
		}
		if float64(a.CallsToday) >= float64(a.DailyQuota)*s.quotaSafetyMargin {
			continue
		}
		if atomic.LoadInt64(&a.inFlight) >= maxIF {
			continue
		}
		for _, ex := range excluded {
			if a.Label == ex {
				continue nextAccount
			}
		}
		candidates = append(candidates, a)
	}
	if len(candidates) == 0 {
		return nil, ErrNoAccountAvailable
	}
	var picked *Account
	switch s.strategy {
	case "round_robin":
		picked = s.selectRoundRobinLocked(candidates)
	case "weighted_random":
		picked = s.selectWeightedRandomLocked(candidates)
	default:
		picked = selectLeastLoaded(candidates, maxIF)
	}
	atomic.AddInt64(&picked.inFlight, 1)
	return cloneLeasedAccountFanout(picked, s.fanoutMax), nil
}

// Release decrements the in-flight counter for the account behind a
// leased clone returned by Select / SelectExcluding. Safe to call from
// any goroutine; idempotent only in the sense that calling it more
// times than Select would drive the counter below zero, so callers
// must defer it exactly once per successful Select.
func (s *Scheduler) Release(account *Account) {
	if account == nil {
		return
	}
	s.mu.Lock()
	a := s.findLocked(account.Label)
	s.mu.Unlock()
	if a == nil {
		return
	}
	atomic.AddInt64(&a.inFlight, -1)
}

func (s *Scheduler) AllAccounts() []*Account {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Account, 0, len(s.accounts))
	for _, a := range s.accounts {
		if a.Enabled {
			cp := *a
			cp.ScriptIDs = append([]string(nil), a.ScriptIDs...)
			out = append(out, &cp)
		}
	}
	return out
}

func (s *Scheduler) SetAccountEnabled(label string, enabled bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.accounts {
		if a.Label == label {
			a.Enabled = enabled
			if enabled {
				a.CooloffUntil = time.Time{}
				a.ConsecutiveErrors = 0
			}
			return true
		}
	}
	return false
}

func (s *Scheduler) ReportSuccess(account *Account, latency time.Duration) {
	if account == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.findLocked(account.Label)
	if a == nil {
		return
	}
	a.CallsToday++
	a.TotalCalls++
	a.ConsecutiveErrors = 0
	a.LastSuccessAt = time.Now()
	a.IsWarm = true
}

func (s *Scheduler) ReportQuotaExceeded(account *Account) {
	if account == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.findLocked(account.Label)
	if a == nil {
		return
	}
	a.CallsToday = a.DailyQuota
	a.TotalErrors++
	a.CooloffUntil = time.Now().Add(s.cooloff)
}

func (s *Scheduler) ReportThrottle(account *Account) {
	if account == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.findLocked(account.Label)
	if a == nil {
		return
	}
	now := time.Now()
	a.TotalErrors++
	cutoff := now.Add(-10 * time.Minute)
	kept := a.throttleTimestamps[:0]
	for _, ts := range a.throttleTimestamps {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	a.throttleTimestamps = append(kept, now)
	if len(a.throttleTimestamps) > 5 {
		a.CooloffUntil = now.Add(s.cooloff)
		a.throttleTimestamps = nil
		return
	}
	a.CooloffUntil = now.Add(s.throttleBackoff)
}

func (s *Scheduler) ReportError(account *Account) {
	if account == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.findLocked(account.Label)
	if a == nil {
		return
	}
	a.ConsecutiveErrors++
	a.TotalErrors++
	if a.ConsecutiveErrors >= 50 {
		a.CooloffUntil = time.Now().Add(s.cooloff)
	} else if a.ConsecutiveErrors >= 20 {
		a.CooloffUntil = time.Now().Add(s.throttleBackoff)
	}
}

func (s *Scheduler) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.rollWindowsLocked(now)
	stats := Stats{Strategy: s.strategy}
	for _, a := range s.accounts {
		stats.TotalDailyQuota += a.DailyQuota
		stats.TotalCallsToday += a.CallsToday
		remaining := a.CooloffUntil.Sub(now).Seconds()
		if remaining < 0 {
			remaining = 0
		}
		percent := 0.0
		if a.DailyQuota > 0 {
			percent = (float64(a.CallsToday) / float64(a.DailyQuota)) * 100
		}
		stats.Accounts = append(stats.Accounts, AccountStats{
			Label:                   a.Label,
			Enabled:                 a.Enabled,
			AccountType:             a.AccountType,
			Deployments:             len(a.ScriptIDs),
			CallsToday:              a.CallsToday,
			DailyQuota:              a.DailyQuota,
			PercentUsed:             round1(percent),
			CooloffRemainingSeconds: round1(remaining),
			ConsecutiveErrors:       a.ConsecutiveErrors,
			IsWarm:                  a.IsWarm,
			TotalCalls:              a.TotalCalls,
			TotalErrors:             a.TotalErrors,
			Weight:                  a.Weight,
			InFlight:                atomic.LoadInt64(&a.inFlight),
			MaxInFlight:             s.maxInFlight,
		})
	}
	return stats
}

func (a *Account) NextScriptID() string {
	if len(a.ScriptIDs) == 0 {
		return ""
	}
	if len(a.ScriptIDs) == 1 {
		return a.ScriptIDs[0]
	}
	sid := a.ScriptIDs[a.sidIndex%len(a.ScriptIDs)]
	a.sidIndex++
	return sid
}

// PickScriptIDs returns up to n script IDs starting at the current
// round-robin offset and advances sidIndex by n. The returned slice
// has no duplicates as long as n <= len(a.ScriptIDs); if n is larger
// the IDs wrap. Must be called under the scheduler mutex (because it
// mutates a.sidIndex on the live, non-cloned account).
func (a *Account) PickScriptIDs(n int) []string {
	if len(a.ScriptIDs) == 0 || n <= 0 {
		return nil
	}
	if n > len(a.ScriptIDs) {
		n = len(a.ScriptIDs)
	}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = a.ScriptIDs[(a.sidIndex+i)%len(a.ScriptIDs)]
	}
	a.sidIndex += n
	return out
}

func (a *Account) UsageRatio() float64 {
	if a.DailyQuota <= 0 {
		return 1
	}
	return float64(a.CallsToday) / float64(a.DailyQuota)
}

func (s *Scheduler) SaveState() error {
	s.mu.Lock()
	state := map[string]persistedAccount{}
	for _, a := range s.accounts {
		state[a.Label] = persistedAccount{
			CallsToday:        a.CallsToday,
			QuotaWindowStart:  a.QuotaWindowStart,
			ConsecutiveErrors: a.ConsecutiveErrors,
			CooloffUntil:      a.CooloffUntil,
			LastSuccessAt:     a.LastSuccessAt,
			LastKeepaliveAt:   a.LastKeepaliveAt,
			IsWarm:            a.IsWarm,
			TotalCalls:        a.TotalCalls,
			TotalErrors:       a.TotalErrors,
		}
	}
	s.mu.Unlock()
	if s.stateFile == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.stateFile), 0o755); err != nil && filepath.Dir(s.stateFile) != "." {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.stateFile, append(data, '\n'), 0o600)
}

// writeFileAtomic writes data to path via tmp + fsync + rename. Without
// the fsync, an interrupted shutdown on Windows can leave NTFS with a
// file at full length but full of NULs, which then fails json.Unmarshal
// with "invalid character '\x00'" on next start.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Scheduler) LoadState() error {
	if s.stateFile == "" {
		return nil
	}
	data, err := os.ReadFile(s.stateFile)
	if err != nil {
		return err
	}
	// Scheduler state is a perf optimization, not load-bearing — if the
	// file is unreadable for any reason (zero-filled by an interrupted
	// shutdown, stale schema, hand-edit), drop it and start fresh rather
	// than blocking Connect.
	var state map[string]persistedAccount
	if err := json.Unmarshal(data, &state); err != nil {
		_ = os.Remove(s.stateFile)
		return nil
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.accounts {
		saved, ok := state[a.Label]
		if !ok {
			continue
		}
		if now.Sub(saved.QuotaWindowStart) >= 24*time.Hour {
			a.QuotaWindowStart = now
			a.TotalCalls = saved.TotalCalls
			a.TotalErrors = saved.TotalErrors
			continue
		}
		a.CallsToday = saved.CallsToday
		a.QuotaWindowStart = saved.QuotaWindowStart
		a.ConsecutiveErrors = saved.ConsecutiveErrors
		a.CooloffUntil = saved.CooloffUntil
		a.LastSuccessAt = saved.LastSuccessAt
		a.LastKeepaliveAt = saved.LastKeepaliveAt
		a.IsWarm = saved.IsWarm
		a.TotalCalls = saved.TotalCalls
		a.TotalErrors = saved.TotalErrors
	}
	return nil
}

type persistedAccount struct {
	CallsToday        int       `json:"calls_today"`
	QuotaWindowStart  time.Time `json:"quota_window_start"`
	ConsecutiveErrors int       `json:"consecutive_errors"`
	CooloffUntil      time.Time `json:"cooloff_until"`
	LastSuccessAt     time.Time `json:"last_success_at"`
	LastKeepaliveAt   time.Time `json:"last_keepalive_at"`
	IsWarm            bool      `json:"is_warm"`
	TotalCalls        int       `json:"total_calls"`
	TotalErrors       int       `json:"total_errors"`
}

func (s *Scheduler) persistLoop() {
	defer close(s.persistStopped)
	if s.persistInterval <= 0 {
		s.persistInterval = 30 * time.Second
	}
	ticker := time.NewTicker(s.persistInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_ = s.SaveState()
		case <-s.stopPersist:
			return
		}
	}
}

func (s *Scheduler) selectRoundRobinLocked(candidates []*Account) *Account {
	a := candidates[s.roundRobinIndex%len(candidates)]
	s.roundRobinIndex++
	return a
}

func (s *Scheduler) selectWeightedRandomLocked(candidates []*Account) *Account {
	total := 0.0
	for _, a := range candidates {
		total += a.Weight
	}
	pick := s.random.Float64() * total
	for _, a := range candidates {
		pick -= a.Weight
		if pick <= 0 {
			return a
		}
	}
	return candidates[len(candidates)-1]
}

// selectLeastLoaded scores candidates by combined load = in-flight share
// + daily-quota share. Lower wins. Both terms are normalized to [0,1] so
// a half-full quota and a half-full in-flight slot count the same. The
// in-flight term is what spreads bursts across accounts in real time;
// the usage term is what spreads the daily budget over the 24h window.
// Ties broken by weight (higher first) then most recently successful.
func selectLeastLoaded(candidates []*Account, maxInFlight int64) *Account {
	score := func(a *Account) float64 {
		usage := a.UsageRatio()
		var inflight float64
		if maxInFlight > 0 {
			inflight = float64(atomic.LoadInt64(&a.inFlight)) / float64(maxInFlight)
		}
		return usage + inflight
	}
	best := candidates[0]
	bestScore := score(best)
	for _, a := range candidates[1:] {
		s := score(a)
		switch {
		case s < bestScore:
			best, bestScore = a, s
		case s == bestScore && a.Weight > best.Weight:
			best, bestScore = a, s
		case s == bestScore && a.Weight == best.Weight && a.LastSuccessAt.After(best.LastSuccessAt):
			best, bestScore = a, s
		}
	}
	return best
}

func (s *Scheduler) findLocked(label string) *Account {
	for _, a := range s.accounts {
		if a.Label == label {
			return a
		}
	}
	return nil
}

func (s *Scheduler) rollWindowsLocked(now time.Time) {
	for _, a := range s.accounts {
		if a.QuotaWindowStart.IsZero() {
			a.QuotaWindowStart = now
			continue
		}
		if now.Sub(a.QuotaWindowStart) >= 24*time.Hour {
			a.CallsToday = 0
			a.QuotaWindowStart = now
			a.CooloffUntil = time.Time{}
		}
	}
}

func cloneAccount(a *Account) *Account {
	cp := *a
	cp.ScriptIDs = append([]string(nil), a.ScriptIDs...)
	return &cp
}

func cloneLeasedAccount(a *Account) *Account {
	sid := a.NextScriptID()
	cp := cloneAccount(a)
	if sid != "" {
		cp.ScriptIDs = []string{sid}
	}
	return cp
}

// cloneLeasedAccountFanout returns a clone whose ScriptIDs slice holds
// up to n IDs starting at the account's current round-robin offset.
// n <= 1 collapses to single-ID (same as cloneLeasedAccount). Used by
// Select() so the provider can race multiple deployments without the
// scheduler having to know about HTTP transport details.
func cloneLeasedAccountFanout(a *Account, n int) *Account {
	if n <= 1 {
		return cloneLeasedAccount(a)
	}
	sids := a.PickScriptIDs(n)
	cp := cloneAccount(a)
	if len(sids) > 0 {
		cp.ScriptIDs = sids
	}
	return cp
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}
