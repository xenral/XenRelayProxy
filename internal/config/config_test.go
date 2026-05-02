package config

import "testing"

func TestValidateRejectsPlaceholderAuth(t *testing.T) {
	cfg := Config{
		AuthKey:     "CHANGE_ME_TO_A_STRONG_SECRET",
		GoogleIP:    "216.239.38.120",
		FrontDomain: "www.google.com",
		Accounts: []Account{{
			Label:      "primary",
			ScriptIDs:  []string{"AKfycbx"},
			DailyQuota: 20000,
			Weight:     1,
			Enabled:    true,
		}},
	}
	cfg.SetDefaults()
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected placeholder auth key to be rejected")
	}
}

func TestNormalizeMigratesLegacyScriptID(t *testing.T) {
	cfg := Config{
		AuthKey:     "secret",
		GoogleIP:    "216.239.38.120",
		FrontDomain: "www.google.com",
		ScriptID:    "AKfycbx",
	}
	cfg.SetDefaults()
	if err := cfg.Normalize(); err != nil {
		t.Fatal(err)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Accounts) != 1 || cfg.Accounts[0].ScriptIDs[0] != "AKfycbx" {
		t.Fatalf("legacy script_id not migrated: %#v", cfg.Accounts)
	}
}

func TestDuplicateLabelsRejected(t *testing.T) {
	cfg := Config{
		AuthKey:     "secret",
		GoogleIP:    "216.239.38.120",
		FrontDomain: "www.google.com",
		Accounts: []Account{
			{Label: "a", ScriptIDs: []string{"sid1"}, DailyQuota: 10, Weight: 1, Enabled: true},
			{Label: "a", ScriptIDs: []string{"sid2"}, DailyQuota: 10, Weight: 1, Enabled: true},
		},
	}
	cfg.SetDefaults()
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected duplicate labels to be rejected")
	}
}
