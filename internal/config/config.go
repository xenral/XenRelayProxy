package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultListenHost          = "127.0.0.1"
	DefaultListenPort          = 8085
	DefaultSOCKS5Port          = 1080
	DefaultGoogleIP            = "216.239.38.120"
	DefaultFrontDomain         = "www.google.com"
	// 90s gives headroom for slow upstreams like Anthropic /v1/messages
	// (non-streaming POSTs routinely take 30–60s). Apps Script's
	// UrlFetchApp soft-caps around 60s and the web app handler can run
	// for ~6 minutes, so the proxy budget should bracket UrlFetchApp,
	// not undercut it.
	DefaultRelayTimeoutSeconds = 90

	// Relay backend modes. ModeAppsScript routes through Google Apps
	// Script; ModeVercel routes through a user-deployed Vercel function.
	// An account-level Provider override takes precedence over the
	// top-level Config.Mode default.
	ModeAppsScript = "apps_script"
	ModeVercel     = "vercel"
)

var placeholderAuthKeys = map[string]struct{}{
	"":                             {},
	"CHANGE_ME_TO_A_STRONG_SECRET": {},
	"your-secret-password-here":    {},
}

type Config struct {
	Mode                 string            `json:"mode"`
	SetupCompleted       bool              `json:"setup_completed"`
	GoogleIP             string            `json:"google_ip"`
	FrontDomain          string            `json:"front_domain"`
	FrontDomains         []string          `json:"front_domains,omitempty"`
	AuthKey              string            `json:"auth_key"`
	ScriptID             string            `json:"script_id,omitempty"`
	ScriptIDs            []string          `json:"script_ids,omitempty"`
	Accounts             []Account         `json:"accounts"`
	Scheduler            Scheduler         `json:"scheduler"`
	ListenHost           string            `json:"listen_host"`
	ListenPort           int               `json:"listen_port"`
	SOCKS5Enabled        bool              `json:"socks5_enabled"`
	SOCKS5Port           int               `json:"socks5_port"`
	LogLevel             string            `json:"log_level"`
	VerifySSL            bool              `json:"verify_ssl"`
	LANSharing           bool              `json:"lan_sharing"`
	RelayTimeout         int               `json:"relay_timeout"`
	TLSConnectTimeout    int               `json:"tls_connect_timeout"`
	TCPConnectTimeout    int               `json:"tcp_connect_timeout"`
	MaxRequestBodyBytes  int64             `json:"max_request_body_bytes"`
	MaxResponseBodyBytes int64             `json:"max_response_body_bytes"`
	DownloadMinSize      int64             `json:"chunked_download_min_size"`
	DownloadChunkSize    int64             `json:"chunked_download_chunk_size"`
	DownloadMaxParallel  int               `json:"chunked_download_max_parallel"`
	DownloadMaxChunks    int               `json:"chunked_download_max_chunks"`
	DownloadExtensions   []string          `json:"chunked_download_extensions"`
	CacheMaxBytes        int64             `json:"cache_max_bytes"`
	MetricsMaxHosts      int               `json:"metrics_max_hosts"`
	BypassHosts          []string          `json:"bypass_hosts"`
	DirectGoogleExclude  []string          `json:"direct_google_exclude"`
	DirectGoogleAllow    []string          `json:"direct_google_allow"`
	SNIRewriteHosts      []string          `json:"sni_rewrite_hosts"`
	ForceRelaySNIHosts   bool              `json:"force_relay_sni_hosts"`
	InjectPermissiveCORS bool              `json:"inject_permissive_cors"`
	CookieDebugMode      bool              `json:"cookie_debug_mode"`
	CookieCriticalHosts  []string          `json:"cookie_critical_hosts"`
	DirectTunnelHosts    []string          `json:"direct_tunnel_hosts"`
	BlockLongPollPaths   []string          `json:"block_long_poll_paths"`
	BlockHosts           []string          `json:"block_hosts"`
	Hosts                map[string]string `json:"hosts"`
}

type Account struct {
	Label       string   `json:"label"`
	Email       string   `json:"email,omitempty"`
	ScriptID    string   `json:"script_id,omitempty"`
	ScriptIDs   []string `json:"script_ids,omitempty"`
	AccountType string   `json:"account_type"`
	Enabled     bool     `json:"enabled"`
	Weight      float64  `json:"weight"`
	DailyQuota  int      `json:"daily_quota"`
	// Provider overrides Config.Mode for this account. Empty means inherit.
	// Valid values are ModeAppsScript and ModeVercel.
	Provider string `json:"provider,omitempty"`
	// VercelURL is the base URL of the user's deployed Vercel function
	// (e.g. https://my-relay.vercel.app). Required when the effective
	// provider is ModeVercel; ignored otherwise.
	VercelURL string `json:"vercel_url,omitempty"`
}

// EffectiveProvider returns the relay backend that should handle requests
// for this account, falling back to the top-level Config.Mode when the
// account's own Provider field is empty.
func (a Account) EffectiveProvider(mode string) string {
	if a.Provider != "" {
		return a.Provider
	}
	if mode != "" {
		return mode
	}
	return ModeAppsScript
}

type Scheduler struct {
	Strategy                    string  `json:"strategy"`
	CooloffSeconds              int     `json:"cooloff_seconds"`
	ThrottleBackoffSeconds      int     `json:"throttle_backoff_seconds"`
	QuotaSafetyMargin           float64 `json:"quota_safety_margin"`
	StateFile                   string  `json:"state_file"`
	StatePersistIntervalSeconds int     `json:"state_persist_interval_seconds"`
	KeepaliveIntervalSeconds    int     `json:"keepalive_interval_seconds"`
	PrewarmOnStart              bool    `json:"prewarm_on_start"`
	// FanoutMax bounds how many of an account's script_ids are raced in
	// parallel per request. 1 disables fan-out (single shot). Apps Script
	// has an undocumented ~30 concurrent execution cap per *script
	// project* shared across all its deployments, so keep this small —
	// 2 is enough to mask cold-container starts without crowding the cap.
	FanoutMax int `json:"fanout_max"`
	// FanoutHedgeDelayMs is the pause before each additional fan-out arm
	// fires after the first. 0 fires all arms simultaneously (lowest
	// latency, highest wasted work). 150ms means fast responses never
	// trigger a second arm; only the slow tail pays.
	FanoutHedgeDelayMs int `json:"fanout_hedge_delay_ms"`
	// AccountMaxInFlight caps concurrent in-flight requests *per account*.
	// Apps Script has an undocumented ~30 concurrent execution cap per
	// script project (shared across deployments), so 20 is a safe default —
	// leaves headroom for keepalives and uncancelled fan-out arms. When
	// every eligible account is at capacity Select() returns
	// ErrNoAccountAvailable; the listener treats this like a quota miss and
	// retries on a different account if one is available.
	AccountMaxInFlight int `json:"account_max_in_flight"`
	// RetryMaxAttempts bounds how many times Client.Do retries on a fresh
	// account when the previous attempt hit a quota/throttle/transient
	// error. 1 means single shot (no retry); 3 means up to 3 distinct
	// accounts get tried before giving up. Auth errors never retry.
	RetryMaxAttempts int `json:"retry_max_attempts"`
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	cfg.SetDefaults()
	if err := cfg.Normalize(); err != nil {
		return Config{}, err
	}
	return cfg, cfg.Validate()
}

// SaveDraft writes cfg without running Validate, so partial configs (e.g. with
// an empty auth_key) can be persisted while the user is still filling in fields.
func SaveDraft(path string, cfg Config) error {
	cfg.SetDefaults()
	if err := cfg.Normalize(); err != nil {
		return err
	}
	return writeJSON(path, cfg)
}

func Save(path string, cfg Config) error {
	cfg.SetDefaults()
	if err := cfg.Normalize(); err != nil {
		return err
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	return writeJSON(path, cfg)
}

func writeJSON(path string, cfg Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (c *Config) SetDefaults() {
	if c.Mode == "" {
		c.Mode = ModeAppsScript
	}
	if c.GoogleIP == "" {
		c.GoogleIP = DefaultGoogleIP
	}
	if c.FrontDomain == "" {
		c.FrontDomain = DefaultFrontDomain
	}
	if c.ListenHost == "" {
		c.ListenHost = DefaultListenHost
	}
	if c.ListenPort == 0 {
		c.ListenPort = DefaultListenPort
	}
	if c.SOCKS5Port == 0 {
		c.SOCKS5Port = DefaultSOCKS5Port
	}
	if c.LogLevel == "" {
		c.LogLevel = "INFO"
	}
	if c.RelayTimeout == 0 {
		c.RelayTimeout = DefaultRelayTimeoutSeconds
	}
	// Migrate the legacy 25s default. It's too low for LLM-style upstreams
	// (Anthropic /v1/messages, OpenAI /v1/chat/completions) which routinely
	// run 30–60s, and Apps Script's UrlFetchApp can hold the connection
	// roughly that long anyway.
	if c.RelayTimeout > 0 && c.RelayTimeout < 60 {
		c.RelayTimeout = DefaultRelayTimeoutSeconds
	}
	if c.TLSConnectTimeout == 0 {
		c.TLSConnectTimeout = 15
	}
	if c.TCPConnectTimeout == 0 {
		c.TCPConnectTimeout = 10
	}
	if c.MaxRequestBodyBytes == 0 {
		c.MaxRequestBodyBytes = 100 * 1024 * 1024
	}
	if c.MaxResponseBodyBytes == 0 {
		c.MaxResponseBodyBytes = 5 * 1024 * 1024 * 1024 // 5 GB
	}
	if c.DownloadMinSize == 0 {
		c.DownloadMinSize = 5 * 1024 * 1024
	}
	if c.DownloadChunkSize == 0 {
		c.DownloadChunkSize = 512 * 1024
	}
	if c.DownloadMaxParallel == 0 {
		c.DownloadMaxParallel = 8
	}
	if c.DownloadMaxChunks == 0 {
		c.DownloadMaxChunks = 256
	}
	if c.CacheMaxBytes == 0 {
		c.CacheMaxBytes = 50 * 1024 * 1024
	}
	if c.MetricsMaxHosts == 0 {
		c.MetricsMaxHosts = 256
	}
	if c.BlockLongPollPaths == nil {
		c.BlockLongPollPaths = []string{
			// x.com long-poll / SSE event streams — these hold the
			// connection open for ~30s and exhaust the relay timeout.
			"api.x.com/live_pipeline/events",
			"api.twitter.com/live_pipeline/events",
			// Google Meet / Hangouts WebSocket-equivalents.
			"clients6.google.com/meetings",
			"waa-pa.clients6.google.com",
			// Generic SSE / WebSocket-upgrade signals.
			"/api/v1/events",
			"/api/v2/events",
		}
	}
	if len(c.DownloadExtensions) == 0 {
		c.DownloadExtensions = []string{
			".bin", ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
			".exe", ".msi", ".dmg", ".deb", ".rpm", ".apk", ".iso", ".img",
			".mp4", ".mkv", ".avi", ".mov", ".webm", ".mp3", ".flac", ".wav",
			".aac", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".wasm",
		}
	}
	if len(c.BypassHosts) == 0 {
		c.BypassHosts = []string{"localhost", ".local", ".lan", ".home.arpa"}
	}
	if len(c.DirectGoogleAllow) == 0 {
		c.DirectGoogleAllow = []string{"www.google.com", "google.com", "safebrowsing.google.com"}
	}
	if len(c.SNIRewriteHosts) == 0 {
		c.SNIRewriteHosts = []string{
			"youtube.com", "youtu.be", "youtube-nocookie.com", "ytimg.com",
			"ggpht.com", "gvt1.com", "gvt2.com", "doubleclick.net",
			"googlesyndication.com", "googleadservices.com", "google-analytics.com",
			"googletagmanager.com", "googletagservices.com", "fonts.googleapis.com",
			"script.google.com",
		}
	}
	if c.Hosts == nil {
		c.Hosts = map[string]string{}
	}
	if c.Scheduler.Strategy == "" {
		c.Scheduler.Strategy = "least_loaded"
	}
	if c.Scheduler.CooloffSeconds == 0 {
		c.Scheduler.CooloffSeconds = 900
	}
	if c.Scheduler.ThrottleBackoffSeconds == 0 {
		c.Scheduler.ThrottleBackoffSeconds = 60
	}
	if c.Scheduler.QuotaSafetyMargin == 0 {
		c.Scheduler.QuotaSafetyMargin = 0.95
	}
	if c.Scheduler.StateFile == "" {
		c.Scheduler.StateFile = "state/scheduler_state.json"
	}
	if c.Scheduler.StatePersistIntervalSeconds == 0 {
		c.Scheduler.StatePersistIntervalSeconds = 30
	}
	if c.Scheduler.KeepaliveIntervalSeconds == 0 {
		c.Scheduler.KeepaliveIntervalSeconds = 180
	}
	if c.Scheduler.FanoutMax == 0 {
		c.Scheduler.FanoutMax = 2
	}
	if c.Scheduler.FanoutHedgeDelayMs == 0 {
		c.Scheduler.FanoutHedgeDelayMs = 150
	}
	if c.Scheduler.AccountMaxInFlight == 0 {
		c.Scheduler.AccountMaxInFlight = 20
	}
	if c.Scheduler.RetryMaxAttempts == 0 {
		c.Scheduler.RetryMaxAttempts = 2
	}
}

func (c *Config) Normalize() error {
	c.Mode = strings.TrimSpace(strings.ToLower(c.Mode))
	switch c.Mode {
	case "":
		c.Mode = ModeAppsScript
	case ModeAppsScript, ModeVercel:
		// ok
	default:
		return fmt.Errorf("unsupported mode: %s (expected %s or %s)", c.Mode, ModeAppsScript, ModeVercel)
	}
	c.GoogleIP = strings.TrimSpace(c.GoogleIP)
	c.FrontDomain = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(c.FrontDomain, ".")))
	c.AuthKey = strings.TrimSpace(c.AuthKey)

	if c.LANSharing && c.ListenHost == DefaultListenHost {
		c.ListenHost = "0.0.0.0"
	}

	if len(c.Accounts) == 0 {
		switch {
		case validScriptID(c.ScriptID):
			c.Accounts = []Account{{
				Label:       "default",
				ScriptID:    c.ScriptID,
				AccountType: "consumer",
				Enabled:     true,
				Weight:      1,
				DailyQuota:  20000,
			}}
		case len(c.ScriptIDs) > 0:
			c.Accounts = []Account{{
				Label:       "default",
				ScriptIDs:   c.ScriptIDs,
				AccountType: "consumer",
				Enabled:     true,
				Weight:      1,
				DailyQuota:  20000,
			}}
		}
	}

	for i := range c.Accounts {
		a := &c.Accounts[i]
		a.Label = strings.TrimSpace(a.Label)
		a.Email = strings.TrimSpace(a.Email)
		a.ScriptID = strings.TrimSpace(a.ScriptID)
		a.Provider = strings.TrimSpace(strings.ToLower(a.Provider))
		switch a.Provider {
		case "", ModeAppsScript, ModeVercel:
			// ok
		default:
			return fmt.Errorf("account %q has unsupported provider: %s", a.Label, a.Provider)
		}
		a.VercelURL = strings.TrimRight(strings.TrimSpace(a.VercelURL), "/")
		if a.AccountType == "" {
			a.AccountType = "consumer"
		}
		if a.Weight <= 0 {
			a.Weight = 1
		}
		if a.DailyQuota == 0 {
			if a.AccountType == "workspace" {
				a.DailyQuota = 100000
			} else {
				a.DailyQuota = 20000
			}
		}
		if len(a.ScriptIDs) == 0 && a.ScriptID != "" {
			a.ScriptIDs = []string{a.ScriptID}
		}
		for j := range a.ScriptIDs {
			a.ScriptIDs[j] = strings.TrimSpace(a.ScriptIDs[j])
		}
	}
	return nil
}

func (c Config) Validate() error {
	if _, ok := placeholderAuthKeys[c.AuthKey]; ok {
		return errors.New("auth_key is unset or uses a known placeholder")
	}
	if c.GoogleIP == "" {
		return errors.New("google_ip is required")
	}
	if c.FrontDomain == "" {
		return errors.New("front_domain is required")
	}
	if c.ListenPort <= 0 || c.ListenPort > 65535 {
		return fmt.Errorf("listen_port out of range: %d", c.ListenPort)
	}
	if c.SOCKS5Enabled && (c.SOCKS5Port <= 0 || c.SOCKS5Port > 65535) {
		return fmt.Errorf("socks5_port out of range: %d", c.SOCKS5Port)
	}
	if len(c.Accounts) == 0 {
		return errors.New("at least one account is required")
	}
	labels := map[string]struct{}{}
	for _, a := range c.Accounts {
		if a.Label == "" {
			return errors.New("each account must have a non-empty label")
		}
		if _, exists := labels[a.Label]; exists {
			return fmt.Errorf("duplicate account label: %s", a.Label)
		}
		labels[a.Label] = struct{}{}
		switch a.EffectiveProvider(c.Mode) {
		case ModeVercel:
			if a.VercelURL == "" {
				return fmt.Errorf("account %q (vercel mode) requires vercel_url", a.Label)
			}
			if !strings.HasPrefix(a.VercelURL, "http://") && !strings.HasPrefix(a.VercelURL, "https://") {
				return fmt.Errorf("account %q vercel_url must start with http:// or https:// (got %q)", a.Label, a.VercelURL)
			}
		default:
			if len(a.ScriptIDs) == 0 {
				return fmt.Errorf("account %q has no script IDs", a.Label)
			}
			for _, sid := range a.ScriptIDs {
				if !validScriptID(sid) {
					return fmt.Errorf("account %q has missing or placeholder script ID", a.Label)
				}
			}
		}
		if a.DailyQuota <= 0 {
			return fmt.Errorf("account %q daily_quota must be positive", a.Label)
		}
	}
	switch c.Scheduler.Strategy {
	case "least_loaded", "round_robin", "weighted_random":
	default:
		return fmt.Errorf("unsupported scheduler strategy: %s", c.Scheduler.Strategy)
	}
	if c.Scheduler.QuotaSafetyMargin <= 0 || c.Scheduler.QuotaSafetyMargin > 1 {
		return errors.New("scheduler.quota_safety_margin must be > 0 and <= 1")
	}
	if c.Scheduler.FanoutMax < 1 || c.Scheduler.FanoutMax > 5 {
		return fmt.Errorf("scheduler.fanout_max must be in [1, 5] (got %d)", c.Scheduler.FanoutMax)
	}
	if c.Scheduler.FanoutHedgeDelayMs < 0 {
		return fmt.Errorf("scheduler.fanout_hedge_delay_ms must be >= 0 (got %d)", c.Scheduler.FanoutHedgeDelayMs)
	}
	if c.Scheduler.AccountMaxInFlight < 1 || c.Scheduler.AccountMaxInFlight > 30 {
		return fmt.Errorf("scheduler.account_max_in_flight must be in [1, 30] (got %d)", c.Scheduler.AccountMaxInFlight)
	}
	if c.Scheduler.RetryMaxAttempts < 1 || c.Scheduler.RetryMaxAttempts > 5 {
		return fmt.Errorf("scheduler.retry_max_attempts must be in [1, 5] (got %d)", c.Scheduler.RetryMaxAttempts)
	}
	return nil
}

func validScriptID(s string) bool {
	s = strings.TrimSpace(s)
	return s != "" && s != "YOUR_APPS_SCRIPT_DEPLOYMENT_ID"
}
