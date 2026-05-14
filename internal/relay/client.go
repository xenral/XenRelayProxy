package relay

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

// Client is the entry point used by the listener. It owns the scheduler
// account selection, error classification, and metrics bookkeeping. The
// actual transport is delegated to one Provider per backend (Apps Script
// and Vercel today). Picking which Provider to use is per-request, based
// on the chosen account's Provider field falling back to cfg.Mode — so
// one Config can mix backends without restarting.
type Client struct {
	cfg       config.Config
	sched     *scheduler.Scheduler
	metrics   *obs.Metrics
	log       *slog.Logger
	scriptURL string

	apps   Provider
	vercel Provider
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
	c.apps = NewAppsScriptProvider(cfg, c.scriptURL)
	c.vercel = NewVercelProvider(cfg)
	return c
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	start := time.Now()
	host := ""
	if req != nil && req.URL != nil {
		host = req.URL.Hostname()
	}
	env, err := protocol.BuildEnvelope(req, c.cfg.AuthKey, c.cfg.MaxRequestBodyBytes)
	if err != nil {
		c.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}

	maxAttempts := c.cfg.Scheduler.RetryMaxAttempts
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	var excluded []string
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		account, selErr := c.sched.SelectExcluding(excluded)
		if selErr != nil {
			// Pool exhausted. If we already have a richer error from a
			// previous attempt, surface that — it tells the user *why*
			// (quota, throttle, transient 5xx) rather than the generic
			// "no relay account available".
			if lastErr != nil {
				c.metrics.Record(host, 0, 0, time.Since(start), lastErr)
				return nil, lastErr
			}
			c.metrics.Record(host, 0, 0, time.Since(start), selErr)
			return nil, selErr
		}
		prov := resolveProvider(account, c.cfg.Mode, c.apps, c.vercel)
		reply, rawLen, postErr := prov.PostSingle(ctx, account, env)
		class := ClassifyError(postErr)
		switch class {
		case ErrorQuota:
			c.sched.ReportQuotaExceeded(account)
		case ErrorThrottle:
			c.sched.ReportThrottle(account)
		case ErrorTransient:
			c.sched.ReportError(account)
		}
		if postErr == nil {
			resp, parseErr := protocol.ResponseFromReply(req, reply)
			if parseErr != nil {
				c.sched.Release(account)
				c.metrics.Record(host, 0, int64(rawLen), time.Since(start), parseErr)
				return nil, parseErr
			}
			c.sched.ReportSuccess(account, time.Since(start))
			c.sched.Release(account)
			c.metrics.Record(host, requestSize(env), resp.ContentLength, time.Since(start), nil)
			return resp, nil
		}
		c.sched.Release(account)
		lastErr = postErr
		// Retry policy is intentionally narrow. We ONLY retry on classes
		// where switching to a different account can plausibly help:
		//
		//   Quota    — this account is out of its daily allowance; another
		//              account has its own pool, so retry can succeed.
		//   Throttle — this account is being short-window rate-limited;
		//              another account is not.
		//
		// We deliberately do NOT retry on ErrorTransient. A transient 5xx
		// from Apps Script almost always reflects a problem at the
		// destination URL (which is the same for every account) or a
		// blip in script.google.com itself (which every account shares).
		// Switching accounts costs another full upstream call without
		// changing the outcome — and when the upstream is broadly
		// failing, this amplification turns each client request into
		// N * FanoutMax * RetryMaxAttempts upstream hits, which is how a
		// 22% success rate becomes a 7000-error storm. Same logic for
		// Auth: a misconfigured deployment doesn't fix itself on retry.
		switch class {
		case ErrorQuota, ErrorThrottle:
			excluded = append(excluded, account.Label)
			continue
		default:
			c.metrics.Record(host, 0, 0, time.Since(start), postErr)
			return nil, postErr
		}
	}
	c.metrics.Record(host, 0, 0, time.Since(start), lastErr)
	return nil, lastErr
}

func (c *Client) DoBatch(ctx context.Context, reqs []*http.Request) ([]*http.Response, error) {
	if len(reqs) == 0 {
		return nil, nil
	}
	account, err := c.sched.Select()
	if err != nil {
		return nil, err
	}
	defer c.sched.Release(account)
	envs := make([]protocol.Envelope, 0, len(reqs))
	for _, req := range reqs {
		env, err := protocol.BuildEnvelope(req, "", c.cfg.MaxRequestBodyBytes)
		if err != nil {
			return nil, err
		}
		envs = append(envs, env)
	}
	prov := resolveProvider(account, c.cfg.Mode, c.apps, c.vercel)
	reply, err := prov.PostBatch(ctx, account, envs)
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

// classPriority orders error classes from most to least consequential
// for scheduler bookkeeping. Quota wins because reporting it triggers
// the longest cooloff; auth next because it means the deployment is
// unreachable until reconfigured. This is the precedence used when
// multiple fan-out arms fail with different error classes.
func classPriority(c ErrorClass) int {
	switch c {
	case ErrorQuota:
		return 4
	case ErrorAuth:
		return 3
	case ErrorThrottle:
		return 2
	case ErrorTransient:
		return 1
	default:
		return 0
	}
}

// worstError picks the most consequential error from a slice of fan-out
// arm failures so Client.Do reports the right thing to the scheduler.
func worstError(errs []error) error {
	var worst error
	worstRank := -1
	for _, e := range errs {
		if e == nil {
			continue
		}
		r := classPriority(ClassifyError(e))
		if r > worstRank {
			worstRank = r
			worst = e
		}
	}
	return worst
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
