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
	prov := resolveProvider(account, c.cfg.Mode, c.apps, c.vercel)
	reply, rawLen, err := prov.PostSingle(ctx, account, env)
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
