package relay

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

// AppsScriptProvider routes envelopes through a Google Apps Script Web App
// deployment. This is the original (and default) backend; the code is the
// same as it lived inside relay.Client before the provider seam was added.
type AppsScriptProvider struct {
	cfg       config.Config
	http      *http.Client
	scriptURL string
}

func NewAppsScriptProvider(cfg config.Config, scriptURL string) *AppsScriptProvider {
	p := &AppsScriptProvider{cfg: cfg, scriptURL: scriptURL}
	p.http = &http.Client{
		Transport: p.transport(),
		Timeout:   time.Duration(cfg.RelayTimeout) * time.Second,
		// Allow redirects — Apps Script POST /exec issues a 302 before the
		// actual response. Blocking redirects returns an HTML page which
		// cannot be parsed as JSON (the "invalid character '<'" error).
	}
	return p
}

func (p *AppsScriptProvider) Name() string { return config.ModeAppsScript }

func (p *AppsScriptProvider) PostSingle(ctx context.Context, account *scheduler.Account, env protocol.Envelope) (protocol.Reply, int, error) {
	var reply protocol.Reply
	body, err := p.raceJSON(ctx, account, env)
	if err != nil {
		return reply, len(body), err
	}
	reply, err = protocol.ParseSingle(body)
	return reply, len(body), err
}

func (p *AppsScriptProvider) PostBatch(ctx context.Context, account *scheduler.Account, envs []protocol.Envelope) ([]protocol.Reply, error) {
	payload := protocol.Envelope{K: p.cfg.AuthKey, Q: envs}
	sid := account.NextScriptID()
	if sid == "" {
		return nil, fmt.Errorf("account %s has no script ID", account.Label)
	}
	body, err := p.postJSONScript(ctx, sid, payload)
	if err != nil {
		return nil, err
	}
	return protocol.ParseBatch(body, len(envs))
}

// raceJSON hedges a single envelope across multiple deployment IDs of
// the same account. The leased Account clone from the scheduler already
// holds up to FanoutMax script IDs (cloneLeasedAccountFanout). We fire
// the first arm immediately; each subsequent arm waits an additional
// FanoutHedgeDelayMs. The first 2xx wins and cancels the rest. Cancelled
// UrlFetchApp calls don't count against the account's daily quota — so
// this is a pure latency win, not a quota multiplier.
//
// On full failure all errors are collected and the most consequential
// one (worstError) is returned, so Client.Do can apply the most
// conservative scheduler bookkeeping action.
func (p *AppsScriptProvider) raceJSON(ctx context.Context, account *scheduler.Account, payload any) ([]byte, error) {
	arms := account.ScriptIDs
	if len(arms) == 0 {
		return nil, fmt.Errorf("account %s has no script ID", account.Label)
	}
	if len(arms) == 1 {
		return p.postJSONScript(ctx, arms[0], payload)
	}
	raceCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	type result struct {
		body []byte
		err  error
	}
	results := make(chan result, len(arms))
	hedge := time.Duration(p.cfg.Scheduler.FanoutHedgeDelayMs) * time.Millisecond

	for i, sid := range arms {
		go func() {
			if i > 0 && hedge > 0 {
				timer := time.NewTimer(time.Duration(i) * hedge)
				select {
				case <-timer.C:
				case <-raceCtx.Done():
					timer.Stop()
					results <- result{err: raceCtx.Err()}
					return
				}
			}
			body, err := p.postJSONScript(raceCtx, sid, payload)
			results <- result{body: body, err: err}
		}()
	}

	errs := make([]error, 0, len(arms))
	for range arms {
		r := <-results
		if r.err == nil {
			return r.body, nil
		}
		errs = append(errs, r.err)
	}
	return nil, worstError(errs)
}

func (p *AppsScriptProvider) postJSONScript(ctx context.Context, scriptID string, payload any) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	endpoint := p.endpoint(scriptID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
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
	if resp.StatusCode >= 500 {
		return body, fmt.Errorf("relay HTTP %d: %s", resp.StatusCode, stringPrefix(body, 200))
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return body, fmt.Errorf("unauthorized: relay HTTP %d", resp.StatusCode)
	}
	if resp.StatusCode >= 300 || looksLikeHTML(body) {
		// Apps Script returns HTML (Drive landing, login, or error pages)
		// when the deployment URL is wrong or its access settings are
		// misconfigured. Most users hit this after redeploying via "New
		// deployment" instead of "Manage deployments → New version".
		if looksLikeDeploymentMissingPage(body) {
			return body, fmt.Errorf(
				"apps script deployment not found (HTTP %d) — your script_id likely points to a deleted/orphaned deployment. "+
					"Open Apps Script → Deploy → Manage deployments → copy the URL of the active deployment and update Script Deployment ID in Settings → Accounts. "+
					"Tip: redeploy with 'Manage deployments → ✏️ → Version: New version' to keep the same URL",
				resp.StatusCode)
		}
		if resp.StatusCode >= 300 {
			return body, fmt.Errorf("relay HTTP %d (unexpected redirect): %s", resp.StatusCode, stringPrefix(body, 120))
		}
		return body, fmt.Errorf(
			"apps script returned HTML instead of JSON — verify: deployment type=Web app, Execute as=Me, Who has access=Anyone (got: %s)",
			stringPrefix(body, 120))
	}
	return body, nil
}

// looksLikeDeploymentMissingPage detects Apps Script's "deployment not
// found" / Drive soft-404 landing page, which is served in the user's
// locale and contains marketing copy about Docs/Sheets. Pinpointing it
// lets us turn a confusing "unexpected redirect" error into a clear
// "your deployment ID is wrong" hint.
func looksLikeDeploymentMissingPage(body []byte) bool {
	if !looksLikeHTML(body) {
		return false
	}
	low := bytes.ToLower(body)
	// Each phrase appears in Apps Script's deployment-missing landing,
	// localized to the user's Google account language.
	hints := [][]byte{
		// English
		[]byte("script.google.com"),
		[]byte("workspace"),
		// German (the user's case)
		[]byte("textverarbeitung"),
		[]byte("präsentationen"),
		// Spanish
		[]byte("procesador de texto"),
		// French
		[]byte("traitement de texte"),
		// Generic Apps Script error pages
		[]byte("requested entity was not found"),
		[]byte("page not found"),
	}
	matches := 0
	for _, hint := range hints {
		if bytes.Contains(low, hint) {
			matches++
		}
	}
	return matches >= 1
}

func (p *AppsScriptProvider) endpoint(scriptID string) string {
	if p.scriptURL != "" {
		u, err := url.Parse(p.scriptURL)
		if err == nil {
			q := u.Query()
			q.Set("sid", scriptID)
			u.RawQuery = q.Encode()
			return u.String()
		}
	}
	return "https://script.google.com/macros/s/" + url.PathEscape(scriptID) + "/exec"
}

func (p *AppsScriptProvider) transport() http.RoundTripper {
	base := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   time.Duration(p.cfg.TCPConnectTimeout) * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: time.Duration(p.cfg.TLSConnectTimeout) * time.Second,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 50,
		IdleConnTimeout:     45 * time.Second,
	}
	if p.scriptURL != "" {
		return base
	}
	base.Proxy = nil
	base.DialTLSContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialer := &net.Dialer{
			Timeout:   time.Duration(p.cfg.TCPConnectTimeout) * time.Second,
			KeepAlive: 30 * time.Second,
		}
		raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(p.cfg.GoogleIP, "443"))
		if err != nil {
			return nil, err
		}
		tlsCfg := &tls.Config{
			ServerName:         p.cfg.FrontDomain,
			InsecureSkipVerify: !p.cfg.VerifySSL,
			MinVersion:         tls.VersionTLS12,
			NextProtos:         []string{"h2", "http/1.1"},
		}
		tc := tls.Client(raw, tlsCfg)
		if err := tc.HandshakeContext(ctx); err != nil {
			_ = raw.Close()
			return nil, err
		}
		return tc, nil
	}
	return base
}
