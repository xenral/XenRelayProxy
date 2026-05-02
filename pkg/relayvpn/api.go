package relayvpn

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"xenrelayproxy/internal/certstore"
	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/frontscan"
	"xenrelayproxy/internal/listener"
	"xenrelayproxy/internal/mitm"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/relay"
	"xenrelayproxy/internal/scheduler"
)

type EventSink func(event string, payload any)

type API struct {
	mu         sync.Mutex
	configPath string
	cfg        config.Config
	status     Status
	metrics    *obs.Metrics
	logs       *obs.Ring
	events     EventSink

	sched  *scheduler.Scheduler
	server *listener.Server
	mitm   *mitm.Manager
	cancel context.CancelFunc
}

type Status struct {
	State         string `json:"state"`
	Running       bool   `json:"running"`
	ConfigPath    string `json:"config_path"`
	ListenAddress string `json:"listen_address"`
	SOCKS5Address string `json:"socks5_address"`
	ActiveAccount string `json:"active_account,omitempty"`
	CATrusted     bool   `json:"ca_trusted"`
	LastError     string `json:"last_error,omitempty"`
	StartedAt     string `json:"started_at,omitempty"`
	Version       string `json:"version"`
}

type Stats struct {
	Status    Status          `json:"status"`
	Metrics   obs.Snapshot    `json:"metrics"`
	Scheduler scheduler.Stats `json:"scheduler"`
	Logs      []obs.Entry     `json:"logs"`
}

const Version = "0.1.0"

func NewAPI(configPath string) *API {
	if configPath == "" {
		configPath = "config.json"
	}
	logs := obs.NewRing(1000)
	api := &API{
		configPath: configPath,
		metrics:    obs.NewMetrics(),
		logs:       logs,
		status: Status{
			State:      "DISCONNECTED",
			ConfigPath: configPath,
			Version:    Version,
		},
	}
	logs.Subscribe(func(entry obs.Entry) {
		api.emit("log", entry)
	})
	return api
}

func WailsEventSink(ctx context.Context) EventSink {
	return func(event string, payload any) {
		runtime.EventsEmit(ctx, "xenrelayproxy:"+event, payload)
	}
}

func (a *API) SetEventSink(sink EventSink) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.events = sink
}

func (a *API) Start(ctx context.Context) error {
	a.mu.Lock()
	if a.status.Running {
		a.mu.Unlock()
		return nil
	}
	a.status.State = "CONNECTING"
	a.status.LastError = ""
	a.emitLocked("status", a.status)
	a.mu.Unlock()

	cfg, err := config.Load(a.configPath)
	if err != nil {
		a.setError(err)
		return err
	}
	if cfg.LANSharing && cfg.ListenHost == "127.0.0.1" {
		cfg.ListenHost = "0.0.0.0"
	}
	mitmMgr, err := mitm.NewManager(mitm.DefaultCACertFile, mitm.DefaultCAKeyFile)
	if err != nil {
		a.setError(err)
		return err
	}

	log := slog.New(obs.NewHandler(a.logs))
	sched := scheduler.New(cfg.Accounts, cfg.Scheduler)
	if err := sched.Start(); err != nil {
		a.setError(err)
		return err
	}
	relayClient := relay.NewClient(cfg, sched, a.metrics, log)
	server := listener.NewServer(cfg, relayClient, mitmMgr, sched, a.metrics, a.logs, log)
	runCtx, cancel := context.WithCancel(ctx)
	if err := server.Start(runCtx); err != nil {
		cancel()
		_ = sched.Stop()
		a.setError(err)
		return err
	}

	a.mu.Lock()
	a.cfg = cfg
	a.sched = sched
	a.server = server
	a.mitm = mitmMgr
	a.cancel = cancel
	a.status = Status{
		State:         "CONNECTED",
		Running:       true,
		ConfigPath:    a.configPath,
		ListenAddress: fmt.Sprintf("%s:%d", cfg.ListenHost, cfg.ListenPort),
		CATrusted:     certstore.IsTrusted(mitmMgr.CACertFile()),
		StartedAt:     time.Now().Format(time.RFC3339),
		Version:       Version,
	}
	if cfg.SOCKS5Enabled {
		a.status.SOCKS5Address = fmt.Sprintf("%s:%d", cfg.ListenHost, cfg.SOCKS5Port)
	}
	if len(cfg.Accounts) > 0 {
		a.status.ActiveAccount = cfg.Accounts[0].Label
	}
	a.emitLocked("status", a.status)
	a.mu.Unlock()
	a.logs.Add(obs.LevelInfo, "core", "XenRelayProxy started")
	return nil
}

func (a *API) Stop() error {
	a.mu.Lock()
	server := a.server
	sched := a.sched
	cancel := a.cancel
	a.server = nil
	a.sched = nil
	a.cancel = nil
	a.status.Running = false
	a.status.State = "DISCONNECTED"
	a.status.LastError = ""
	a.status.StartedAt = ""
	a.emitLocked("status", a.status)
	a.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	if server != nil {
		_ = server.Stop(ctx)
	}
	if sched != nil {
		_ = sched.Stop()
	}
	a.logs.Add(obs.LevelInfo, "core", "XenRelayProxy stopped")
	return nil
}

func (a *API) Status() Status {
	a.mu.Lock()
	defer a.mu.Unlock()
	status := a.status
	if a.mitm != nil {
		status.CATrusted = certstore.IsTrusted(a.mitm.CACertFile())
	}
	return status
}

func (a *API) Stats() Stats {
	a.mu.Lock()
	status := a.status
	sched := a.sched
	a.mu.Unlock()
	var schedStats scheduler.Stats
	if sched != nil {
		schedStats = sched.Stats()
	}
	return Stats{
		Status:    status,
		Metrics:   a.metrics.Snapshot(),
		Scheduler: schedStats,
		Logs:      a.logs.Tail(250),
	}
}

func (a *API) GetConfig() (config.Config, error) {
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return config.Config{}, err
	}
	return cfg, nil
}

func (a *API) SaveConfig(cfg config.Config) error {
	cfg.SetDefaults()
	if err := cfg.Normalize(); err != nil {
		return err
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	if err := config.Save(a.configPath, cfg); err != nil {
		return err
	}
	a.logs.Add(obs.LevelInfo, "config", "configuration saved")
	a.mu.Lock()
	a.cfg = cfg
	a.mu.Unlock()
	return nil
}

func (a *API) ValidateConfig(cfg config.Config) error {
	cfg.SetDefaults()
	if err := cfg.Normalize(); err != nil {
		return err
	}
	return cfg.Validate()
}

func (a *API) InstallCA() error {
	mgr, err := a.ensureCA()
	if err != nil {
		return err
	}
	a.logs.Add(obs.LevelInfo, "cert", "installing local CA")
	return certstore.Install(mgr.CACertFile())
}

func (a *API) UninstallCA() error {
	mgr, err := a.ensureCA()
	if err != nil {
		return err
	}
	a.logs.Add(obs.LevelInfo, "cert", "uninstalling local CA")
	return certstore.Uninstall(mgr.CACertFile())
}

func (a *API) IsCATrusted() bool {
	mgr, err := a.ensureCA()
	if err != nil {
		return false
	}
	return certstore.IsTrusted(mgr.CACertFile())
}

func (a *API) ScanFrontIPs(ctx context.Context) ([]frontscan.Result, error) {
	cfg, err := a.GetConfig()
	if err != nil {
		return nil, err
	}
	a.logs.Add(obs.LevelInfo, "scanner", "scanning Google frontend IPs")
	return frontscan.Scan(ctx, cfg.FrontDomain, nil)
}

func (a *API) ToggleAccount(label string, enabled bool) error {
	if label == "" {
		return errors.New("label is required")
	}
	cfg, err := a.GetConfig()
	if err != nil {
		return err
	}
	found := false
	for i := range cfg.Accounts {
		if cfg.Accounts[i].Label == label {
			cfg.Accounts[i].Enabled = enabled
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("account %q not found", label)
	}
	if err := a.SaveConfig(cfg); err != nil {
		return err
	}
	a.mu.Lock()
	if a.sched != nil {
		a.sched.SetAccountEnabled(label, enabled)
	}
	a.mu.Unlock()
	a.logs.Add(obs.LevelInfo, "scheduler", fmt.Sprintf("account %s enabled=%v", label, enabled))
	return nil
}

func (a *API) ensureCA() (*mitm.Manager, error) {
	a.mu.Lock()
	if a.mitm != nil {
		mgr := a.mitm
		a.mu.Unlock()
		return mgr, nil
	}
	a.mu.Unlock()
	mgr, err := mitm.NewManager(mitm.DefaultCACertFile, mitm.DefaultCAKeyFile)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.mitm = mgr
	a.mu.Unlock()
	return mgr, nil
}

func (a *API) setError(err error) {
	a.logs.Add(obs.LevelError, "core", err.Error())
	a.mu.Lock()
	defer a.mu.Unlock()
	a.status.Running = false
	a.status.State = "ERROR"
	a.status.LastError = err.Error()
	a.emitLocked("status", a.status)
}

func (a *API) emit(event string, payload any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.emitLocked(event, payload)
}

func (a *API) emitLocked(event string, payload any) {
	if a.events != nil {
		a.events(event, payload)
	}
}
