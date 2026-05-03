package relayvpn

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"xenrelayproxy/internal/config"
)

func newTestAPI(t *testing.T) (*API, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	caCert := filepath.Join(dir, "ca", "ca.crt")
	caKey := filepath.Join(dir, "ca", "ca.key")
	api := NewAPI(cfgPath, caCert, caKey)
	return api, dir
}

func TestStatusBeforeStart(t *testing.T) {
	api, _ := newTestAPI(t)
	st := api.Status()
	if st.Running {
		t.Fatal("Status() should report not running before Start")
	}
	if st.State != "DISCONNECTED" {
		t.Fatalf("State = %q want DISCONNECTED", st.State)
	}
	if st.Version == "" {
		t.Fatal("version should be populated")
	}
}

func TestGetConfigReturnsDefaultsWhenMissing(t *testing.T) {
	api, _ := newTestAPI(t)
	cfg, err := api.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if cfg.ListenPort == 0 {
		t.Fatal("defaults not populated")
	}
	if cfg.CacheMaxBytes == 0 {
		t.Fatal("CacheMaxBytes default not set")
	}
	if cfg.MetricsMaxHosts == 0 {
		t.Fatal("MetricsMaxHosts default not set")
	}
}

func TestSaveAndLoadConfigRoundTrip(t *testing.T) {
	api, _ := newTestAPI(t)
	cfg := config.Config{
		AuthKey: "test-secret",
		Accounts: []config.Account{{
			Label:       "primary",
			ScriptIDs:   []string{"some-deployment-id"},
			AccountType: "consumer",
			Enabled:     true,
			Weight:      1,
			DailyQuota:  20000,
		}},
	}
	if err := api.SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	loaded, err := api.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if loaded.AuthKey != "test-secret" {
		t.Fatalf("auth key not persisted: %q", loaded.AuthKey)
	}
	if len(loaded.Accounts) != 1 || loaded.Accounts[0].Label != "primary" {
		t.Fatalf("accounts not persisted: %#v", loaded.Accounts)
	}
}

func TestValidateConfigRejectsPlaceholderKey(t *testing.T) {
	api, _ := newTestAPI(t)
	cfg := config.Config{AuthKey: "CHANGE_ME_TO_A_STRONG_SECRET"}
	if err := api.ValidateConfig(cfg); err == nil {
		t.Fatal("expected validation failure for placeholder auth_key")
	}
}

func TestStartFailsWithoutAccounts(t *testing.T) {
	api, _ := newTestAPI(t)
	cfg := config.Config{AuthKey: "real-secret"}
	if err := api.SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	err := api.Start(context.Background())
	if err == nil {
		_ = api.Stop()
		t.Fatal("expected Start to fail without accounts")
	}
	st := api.Status()
	if st.Running {
		t.Fatal("status should not be running after failed Start")
	}
	if st.LastError == "" {
		t.Fatal("LastError should be populated after failed Start")
	}
}

func TestGetCACertInfoCreatesCAOnDemand(t *testing.T) {
	api, dir := newTestAPI(t)
	info := api.GetCACertInfo()
	if !info.Exists {
		t.Fatal("CA should be created on demand")
	}
	if info.Subject == "" || info.Fingerprint == "" {
		t.Fatalf("info missing fields: %#v", info)
	}

	data, err := os.ReadFile(filepath.Join(dir, "ca", "ca.crt"))
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		t.Fatal("CA file is not PEM")
	}
	if _, err := x509.ParseCertificate(block.Bytes); err != nil {
		t.Fatalf("CA file is not a parseable cert: %v", err)
	}
}

func TestEventSinkReceivesStatusUpdates(t *testing.T) {
	api, _ := newTestAPI(t)

	type event struct {
		name    string
		payload any
	}
	var got []event
	api.SetEventSink(func(name string, payload any) {
		got = append(got, event{name, payload})
	})

	cfg := config.Config{AuthKey: "real-secret"}
	if err := api.SaveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	_ = api.Start(context.Background()) // expected to fail (no accounts)
	if len(got) == 0 {
		t.Fatal("expected at least one event to be emitted")
	}
	// Sanity check: status events should be JSON-serializable.
	for _, ev := range got {
		if ev.name == "status" {
			if _, err := json.Marshal(ev.payload); err != nil {
				t.Fatalf("status payload not JSON-serializable: %v", err)
			}
		}
	}
}
