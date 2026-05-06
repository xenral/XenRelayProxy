package main

import (
	"context"
	"os"
	"path/filepath"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/frontscan"
	"xenrelayproxy/pkg/relayvpn"
)

type App struct {
	ctx context.Context
	api *relayvpn.API
}

func NewApp() *App {
	dir := appDataDir()
	return &App{api: relayvpn.NewAPI(
		filepath.Join(dir, "config.json"),
		filepath.Join(dir, "ca", "ca.crt"),
		filepath.Join(dir, "ca", "ca.key"),
	)}
}

// appDataDir returns the per-user config directory for XenRelayProxy on the
// current platform (e.g. ~/Library/Application Support on macOS,
// $XDG_CONFIG_HOME or ~/.config on Linux, %AppData% on Windows), creating it
// if needed. Falls back to the cwd on error.
func appDataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		if home, herr := os.UserHomeDir(); herr == nil {
			base = filepath.Join(home, ".config")
		} else {
			return "."
		}
	}
	dir := filepath.Join(base, "XenRelayProxy")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "."
	}
	return dir
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.api.SetEventSink(relayvpn.WailsEventSink(ctx))
}

func (a *App) shutdown(ctx context.Context) {
	_ = a.api.Stop()
}

func (a *App) Start() error {
	return a.api.Start(a.ctx)
}

func (a *App) Stop() error {
	return a.api.Stop()
}

func (a *App) Status() relayvpn.Status {
	return a.api.Status()
}

func (a *App) Stats() relayvpn.Stats {
	return a.api.Stats()
}

func (a *App) GetConfig() (config.Config, error) {
	return a.api.GetConfig()
}

func (a *App) SaveConfig(cfg config.Config) error {
	return a.api.SaveConfig(cfg)
}

func (a *App) ValidateConfig(cfg config.Config) error {
	return a.api.ValidateConfig(cfg)
}

func (a *App) InstallCA() error {
	return a.api.InstallCA()
}

func (a *App) UninstallCA() error {
	return a.api.UninstallCA()
}

func (a *App) IsCATrusted() bool {
	return a.api.IsCATrusted()
}

func (a *App) ScanFrontIPs() ([]frontscan.Result, error) {
	return a.api.ScanFrontIPs(a.ctx)
}

func (a *App) ToggleAccount(label string, enabled bool) error {
	return a.api.ToggleAccount(label, enabled)
}

func (a *App) GetCACertInfo() relayvpn.CACertInfo {
	return a.api.GetCACertInfo()
}

func (a *App) RevealCACert() error {
	return a.api.RevealCACert()
}
