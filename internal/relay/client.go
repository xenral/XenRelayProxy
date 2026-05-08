package relay

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

type Client struct {
	cfg       config.Config
	sched     *scheduler.Scheduler
	http      *http.Client
	metrics   *obs.Metrics
	log       *slog.Logger
	scriptURL string
}

type Option func(*Client)

func WithBaseURL(base string) Option {
	return func(c *Client) { c.scriptURL = strings.TrimRight(base, "/") }
}

func NewClient(cfg config.Config, sched *scheduler.Scheduler, metrics *obs.Metrics, log *slog.Logger, opts ...Option) *Client {
	if metrics == nil {
		metrics = obs.NewMetrics()
	}
	if log == nil {
		log = slog.Default()
	}
	c := &Client{cfg: cfg, sched: sched, metrics: metrics, log: log}
	for _, opt := range opts {
		opt(c)
	}
	c.http = &http.Client{
		Transport: c.transport(),
		Timeout:   time.Duration(cfg.RelayTimeout) * time.Second,
		// Allow redirects — Apps Script POST /exec issues a 302 before the
		// actual response. Blocking redirects returns an HTML page which
		// cannot be parsed as JSON (the "invalid character '<'" error).
	}
	return c
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	start := time.Now()
	host := ""
	if req != nil && req.URL != nil {
		host = req.URL.Hostname()
	}
	account, err := c.sched.Select()
	if err != nil {
		c.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	env, err := protocol.BuildEnvelope(req, c.cfg.AuthKey, c.cfg.MaxRequestBodyBytes)
	if err != nil {
		c.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	reply, rawLen, err := c.postSingle(ctx, account, env)
	class := ClassifyError(err)
	switch class {
	case ErrorQuota:
		c.sched.ReportQuotaExceeded(account)
	case ErrorThrottle:
		c.sched.ReportThrottle(account)
	case ErrorTransient:
		c.sched.ReportError(account)
	}
	if err != nil {
		c.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	resp, err := protocol.ResponseFromReply(req, reply)
	if err != nil {
		c.metrics.Record(host, 0, int64(rawLen), time.Since(start), err)
		return nil, err
	}
	c.sched.ReportSuccess(account, time.Since(start))
	c.metrics.Record(host, requestSize(env), resp.ContentLength, time.Since(start), nil)
	return resp, nil
}

func (c *Client) DoBatch(ctx context.Context, reqs []*http.Request) ([]*http.Response, error) {
	if len(reqs) == 0 {
		return nil, nil
	}
	account, err := c.sched.Select()
	if err != nil {
		return nil, err
	}
	envs := make([]protocol.Envelope, 0, len(reqs))
	for _, req := range reqs {
		env, err := protocol.BuildEnvelope(req, "", c.cfg.MaxRequestBodyBytes)
		if err != nil {
			return nil, err
		}
		envs = append(envs, env)
	}
	reply, err := c.postBatch(ctx, account, envs)
	if err != nil {
		switch ClassifyError(err) {
		case ErrorQuota:
			c.sched.ReportQuotaExceeded(account)
		case ErrorThrottle:
			c.sched.ReportThrottle(account)
		case ErrorTransient:
			c.sched.ReportError(account)
		}
		return nil, err
	}
	responses := make([]*http.Response, 0, len(reply))
	for i, item := range reply {
		resp, err := protocol.ResponseFromReply(reqs[i], item)
		if err != nil {
			return nil, err
		}
		responses = append(responses, resp)
	}
	c.sched.ReportSuccess(account, 0)
	return responses, nil
}

func (c *Client) postSingle(ctx context.Context, account *scheduler.Account, env protocol.Envelope) (protocol.Reply, int, error) {
	var reply protocol.Reply
	body, err := c.postJSON(ctx, account, env)
	if err != nil {
		return reply, len(body), err
	}
	reply, err = protocol.ParseSingle(body)
	return reply, len(body), err
}

func (c *Client) postBatch(ctx context.Context, account *scheduler.Account, envs []protocol.Envelope) ([]protocol.Reply, error) {
	payload := protocol.Envelope{K: c.cfg.AuthKey, Q: envs}
	body, err := c.postJSON(ctx, account, payload)
	if err != nil {
		return nil, err
	}
	return protocol.ParseBatch(body, len(envs))
}

func (c *Client) postJSON(ctx context.Context, account *scheduler.Account, payload any) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	sid := account.NextScriptID()
	if sid == "" {
		return nil, fmt.Errorf("account %s has no script ID", account.Label)
	}
	endpoint := c.endpoint(sid)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, c.cfg.MaxResponseBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return body, err
	}
	if int64(len(body)) > c.cfg.MaxResponseBodyBytes {
		return body, fmt.Errorf("relay response too large [client-buffer]: %d bytes > max_response_body_bytes %d", len(body), c.cfg.MaxResponseBodyBytes)
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

func (c *Client) endpoint(scriptID string) string {
	if c.scriptURL != "" {
		u, err := url.Parse(c.scriptURL)
		if err == nil {
			q := u.Query()
			q.Set("sid", scriptID)
			u.RawQuery = q.Encode()
			return u.String()
		}
	}
	return "https://script.google.com/macros/s/" + url.PathEscape(scriptID) + "/exec"
}

func (c *Client) transport() http.RoundTripper {
	base := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   time.Duration(c.cfg.TCPConnectTimeout) * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: time.Duration(c.cfg.TLSConnectTimeout) * time.Second,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 50,
		IdleConnTimeout:     45 * time.Second,
	}
	if c.scriptURL != "" {
		return base
	}
	base.Proxy = nil
	base.DialTLSContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialer := &net.Dialer{
			Timeout:   time.Duration(c.cfg.TCPConnectTimeout) * time.Second,
			KeepAlive: 30 * time.Second,
		}
		raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(c.cfg.GoogleIP, "443"))
		if err != nil {
			return nil, err
		}
		tlsCfg := &tls.Config{
			ServerName:         c.cfg.FrontDomain,
			InsecureSkipVerify: !c.cfg.VerifySSL,
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

type ErrorClass string

const (
	ErrorNone      ErrorClass = ""
	ErrorQuota     ErrorClass = "quota"
	ErrorThrottle  ErrorClass = "throttle"
	ErrorTransient ErrorClass = "transient"
	ErrorAuth      ErrorClass = "auth"
	ErrorOther     ErrorClass = "other"
)

func ClassifyError(err error) ErrorClass {
	if err == nil {
		return ErrorNone
	}
	text := strings.ToLower(err.Error())
	switch {
	case strings.Contains(text, "quota") || strings.Contains(text, "service invoked too many times"):
		return ErrorQuota
	case strings.Contains(text, "rate limit") || strings.Contains(text, "throttle") || strings.Contains(text, "too many requests"):
		return ErrorThrottle
	case strings.Contains(text, "unauthorized") || strings.Contains(text, "authorization") || strings.Contains(text, "forbidden"):
		return ErrorAuth
	case errors.Is(err, context.DeadlineExceeded), strings.Contains(text, "timeout"), strings.Contains(text, "connection reset"), strings.Contains(text, "http 502"), strings.Contains(text, "http 503"), strings.Contains(text, "http 504"):
		return ErrorTransient
	default:
		return ErrorOther
	}
}

func requestSize(env protocol.Envelope) int64 {
	n := int64(len(env.U) + len(env.M) + len(env.B))
	for k, v := range env.H {
		n += int64(len(k) + len(v))
	}
	return n
}

func stringPrefix(data []byte, n int) string {
	if len(data) <= n {
		return string(data)
	}
	return string(data[:n])
}

func looksLikeHTML(data []byte) bool {
	t := bytes.TrimSpace(data)
	return bytes.HasPrefix(t, []byte("<")) || bytes.HasPrefix(bytes.ToUpper(t), []byte("<!DOCTYPE"))
}
