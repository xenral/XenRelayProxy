package relay

import (
	"context"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

// Provider is a per-account relay backend. The Client picks one per
// request based on the account's effective provider (account.Provider
// falling back to cfg.Mode), so a single config can mix Apps Script and
// Vercel deployments behind the same scheduler / listener / MITM stack.
type Provider interface {
	// PostSingle sends a single envelope and returns the parsed reply
	// plus the raw response byte length (used for metrics) and any
	// transport / parse error.
	PostSingle(ctx context.Context, account *scheduler.Account, env protocol.Envelope) (protocol.Reply, int, error)
	// PostBatch sends a batch envelope and returns the parsed replies.
	PostBatch(ctx context.Context, account *scheduler.Account, envs []protocol.Envelope) ([]protocol.Reply, error)
	// Name identifies the backend in logs / metrics.
	Name() string
}

// resolveProvider returns the provider that should serve req for the
// given account, falling back to cfg.Mode when account.Provider is
// empty. apps is always returned for the legacy ModeAppsScript.
func resolveProvider(account *scheduler.Account, mode string, apps, vercel Provider) Provider {
	prov := account.Provider
	if prov == "" {
		prov = mode
	}
	switch prov {
	case config.ModeVercel:
		return vercel
	default:
		return apps
	}
}
