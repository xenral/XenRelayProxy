package main

import (
	"context"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/frontscan"
	"xenrelayproxy/pkg/relayvpn"
)

type App struct {
	ctx context.Context
	api *relayvpn.API
}

func NewApp() *App {
	return &App{api: relayvpn.NewAPI("config.json")}
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
