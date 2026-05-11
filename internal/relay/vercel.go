package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

// VercelProvider routes envelopes through a user-deployed Vercel
// function (the /vercel/ subtree of this repo). Wire format is
// identical to Apps Script — same Envelope / Reply shape, same
// {e:"too_large"} too-large signaling — so the rest of the proxy
// (chunked download fallback, error classification, scheduler
// bookkeeping) works without changes regardless of which backend
// served the request.
//
// Auth differs from Apps Script: instead of relying on the AUTH_KEY
// inside the JSON body, the Vercel function checks an X-Relay-Token
// header that's set from cfg.AuthKey on the wire. The body still
// carries the same K field for symmetry / batch backwards-compat.
type VercelProvider struct {
	cfg  config.Config
	http *http.Client
}

func NewVercelProvider(cfg config.Config) *VercelProvider {
	timeout := time.Duration(cfg.RelayTimeout) * time.Second
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	return &VercelProvider{
		cfg: cfg,
		http: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment,
				DialContext: (&net.Dialer{
					Timeout:   time.Duration(cfg.TCPConnectTimeout) * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				TLSHandshakeTimeout: time.Duration(cfg.TLSConnectTimeout) * time.Second,
				ForceAttemptHTTP2:   true,
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 50,
				IdleConnTimeout:     45 * time.Second,
			},
		},
	}
}

func (p *VercelProvider) Name() string { return config.ModeVercel }

func (p *VercelProvider) PostSingle(ctx context.Context, account *scheduler.Account, env protocol.Envelope) (protocol.Reply, int, error) {
	var reply protocol.Reply
	body, err := p.postJSON(ctx, account, "/api/tunnel", env)
	if err != nil {
		return reply, len(body), err
	}
	reply, err = protocol.ParseSingle(body)
	return reply, len(body), err
}

func (p *VercelProvider) PostBatch(ctx context.Context, account *scheduler.Account, envs []protocol.Envelope) ([]protocol.Reply, error) {
	payload := protocol.Envelope{K: p.cfg.AuthKey, Q: envs}
	body, err := p.postJSON(ctx, account, "/api/batch", payload)
	if err != nil {
		return nil, err
	}
	return protocol.ParseBatch(body, len(envs))
}

func (p *VercelProvider) postJSON(ctx context.Context, account *scheduler.Account, path string, payload any) ([]byte, error) {
	if account.VercelURL == "" {
		return nil, fmt.Errorf("account %s has no vercel_url", account.Label)
	}
	endpoint := strings.TrimRight(account.VercelURL, "/") + path
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Relay-Token", p.cfg.AuthKey)
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, p.cfg.MaxResponseBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return body, err
	}
	if int64(len(body)) > p.cfg.MaxResponseBodyBytes {
		return body, fmt.Errorf("relay response too large [client-buffer]: %d bytes > max_response_body_bytes %d", len(body), p.cfg.MaxResponseBodyBytes)
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return body, fmt.Errorf("unauthorized: relay HTTP %d (X-Relay-Token mismatch?)", resp.StatusCode)
	}
	if resp.StatusCode == http.StatusRequestEntityTooLarge {
		// Vercel's edge enforces a 4.5 MB request-body cap on Hobby and
		// gives us this status before our function ever runs. Surface
		// it as a clear error so the user can either upgrade or shrink
		// the request.
		return body, fmt.Errorf("vercel rejected request body as too large (HTTP 413) — increase plan limit or shrink the request")
	}
	if resp.StatusCode >= 500 {
		return body, fmt.Errorf("relay HTTP %d: %s", resp.StatusCode, stringPrefix(body, 200))
	}
	if resp.StatusCode >= 300 {
		return body, fmt.Errorf("relay HTTP %d (unexpected): %s", resp.StatusCode, stringPrefix(body, 120))
	}
	if looksLikeHTML(body) {
		// A *.vercel.app URL that 200s with HTML is almost always the
		// project's marketing landing page (wrong path, missing
		// function, or the user pasted the dashboard URL instead of
		// the deployment URL).
		return body, errors.New(
			"vercel returned HTML instead of JSON — check that vercel_url points at the deployment root and the function is deployed at /api/tunnel and /api/batch")
	}
	return body, nil
}
