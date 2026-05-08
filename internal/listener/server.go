package listener

import (
	"bufio"
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
	"strconv"
	"strings"
	"sync"
	"time"

	"xenrelayproxy/internal/cache"
	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/mitm"
	"xenrelayproxy/internal/obs"
	"xenrelayproxy/internal/protocol"
	"xenrelayproxy/internal/scheduler"
)

type Relay interface {
	Do(context.Context, *http.Request) (*http.Response, error)
}

type MITMMode int

const (
	MITMRelay MITMMode = iota
	MITMSNIRewrite
)

type Server struct {
	cfg       config.Config
	relay     Relay
	mitm      *mitm.Manager
	scheduler *scheduler.Scheduler
	metrics   *obs.Metrics
	logs      *obs.Ring
	log       *slog.Logger
	router    Router
	cache     *cache.Cache
	downloads *obs.Downloads

	httpServer *http.Server
	httpLn     net.Listener
	socksLn    net.Listener
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

func NewServer(cfg config.Config, relay Relay, mitmMgr *mitm.Manager, sched *scheduler.Scheduler, metrics *obs.Metrics, logs *obs.Ring, log *slog.Logger, dl *obs.Downloads) *Server {
	if metrics == nil {
		metrics = obs.NewMetrics()
	}
	if logs == nil {
		logs = obs.NewRing(500)
	}
	if log == nil {
		log = slog.Default()
	}
	if dl == nil {
		dl = obs.NewDownloads()
	}
	return &Server{
		cfg:       cfg,
		relay:     relay,
		mitm:      mitmMgr,
		scheduler: sched,
		metrics:   metrics,
		logs:      logs,
		log:       log,
		router:    NewRouter(cfg),
		cache:     cache.New(cfg.CacheMaxBytes),
		downloads: dl,
	}
}

func (s *Server) Start(ctx context.Context) error {
	if s.relay == nil {
		return errors.New("relay is nil")
	}
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel

	addr := net.JoinHostPort(s.cfg.ListenHost, strconv.Itoa(s.cfg.ListenPort))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.httpLn = ln
	s.httpServer = &http.Server{
		Handler:           http.HandlerFunc(s.handleHTTPProxy),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.logs.Add(obs.LevelInfo, "listener", "HTTP proxy listening on "+addr)
		if err := s.httpServer.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logs.Add(obs.LevelError, "listener", "HTTP proxy stopped: "+err.Error())
		}
	}()

	if s.cfg.SOCKS5Enabled {
		if err := s.startSOCKS(ctx); err != nil {
			_ = s.Stop(context.Background())
			return err
		}
	}
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.httpServer != nil {
		_ = s.httpServer.Shutdown(ctx)
	}
	if s.socksLn != nil {
		_ = s.socksLn.Close()
	}
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) Downloads() *obs.Downloads { return s.downloads }

func (s *Server) handleHTTPProxy(w http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodConnect {
		s.handleConnect(w, req)
		return
	}
	s.serveRelayed(w, req)
}

func (s *Server) handleConnect(w http.ResponseWriter, req *http.Request) {
	host, port, err := splitHostPortDefault(req.Host, "443")
	if err != nil {
		http.Error(w, "bad CONNECT target", http.StatusBadRequest)
		return
	}
	if s.router.IsBlocked(host) {
		http.Error(w, "blocked by XenRelayProxy", http.StatusForbidden)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}
	client, rw, err := hj.Hijack()
	if err != nil {
		return
	}

	if s.router.ShouldBypass(host) || s.router.ShouldDirectGoogle(host) || port != "443" {
		_, _ = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
		target := net.JoinHostPort(host, port)
		if override := s.router.HostOverride(host); override != "" {
			target = net.JoinHostPort(override, port)
		}
		s.directTunnel(target, client, rw.Reader)
		return
	}

	mode := s.mitmModeFor(host)
	_, _ = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
	s.handleMITMStream(host, port, client, mode)
}

// mitmModeFor returns the MITM mode for a given host. SNI-rewrite is the
// default for hosts in `sni_rewrite_hosts`, but the user can force every
// such host through the Apps Script relay by setting
// `force_relay_sni_hosts: true` (e.g. when YouTube is geo-blocked and the
// direct front-tunnel can't reach it).
func (s *Server) mitmModeFor(host string) MITMMode {
	if s.router.ShouldSNIRewrite(host) && !s.cfg.ForceRelaySNIHosts {
		return MITMSNIRewrite
	}
	return MITMRelay
}

func (s *Server) handleMITMStream(host, port string, raw net.Conn, mode MITMMode) {
	defer raw.Close()
	if s.mitm == nil {
		return
	}
	tlsCfg, err := s.mitm.ServerTLSConfig(host)
	if err != nil {
		s.logs.Add(obs.LevelError, "mitm", err.Error())
		return
	}
	tlsConn := tls.Server(raw, tlsCfg)
	if err := tlsConn.Handshake(); err != nil {
		s.logs.Add(obs.LevelWarn, "mitm", "TLS handshake failed for "+host+" — CA not trusted by browser? "+err.Error())
		return
	}
	reader := bufio.NewReader(tlsConn)
	for {
		req, err := http.ReadRequest(reader)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.logs.Add(obs.LevelWarn, "mitm", "read request failed: "+err.Error())
			}
			return
		}
		s.absoluteRequestURL(req, host, port)
		if err := s.writeRequestResponse(tlsConn, req, mode); err != nil {
			s.logs.Add(obs.LevelWarn, "mitm", "write response failed for "+req.URL.String()+": "+err.Error())
			return
		}
		if shouldClose(req.Header) {
			return
		}
	}
}

func (s *Server) writeRequestResponse(conn net.Conn, req *http.Request, mode MITMMode) error {
	// Try streaming download first (MITM relay path only).
	if mode == MITMRelay {
		sw := &rawConnWriter{w: conn}
		if handled, err := s.tryStreamDownload(req, sw); handled {
			if err != nil {
				resp := errorResponse(req, err, http.StatusBadGateway)
				if origin := req.Header.Get("Origin"); origin != "" {
					ensureCORS(resp.Header, origin)
				}
				defer resp.Body.Close()
				return resp.Write(conn)
			}
			return nil
		}
	}

	var resp *http.Response
	var err error
	if mode == MITMSNIRewrite {
		resp, err = s.doSNIRewrite(req)
	} else {
		resp, err = s.responseFor(req)
	}
	if err != nil {
		// Safety net: if the relay reported the upstream response was too
		// large for its per-call cap, retry as a chunked Range download.
		// Mirrors Python's relay() → too_large → relay_parallel() flow.
		var tle *protocol.TooLargeError
		if mode == MITMRelay && errors.As(err, &tle) {
			sw := &rawConnWriter{w: conn}
			if handled, herr := s.tryStreamFromTooLarge(req, sw, tle); handled {
				if herr != nil {
					resp = errorResponse(req, herr, http.StatusBadGateway)
					if origin := req.Header.Get("Origin"); origin != "" {
						ensureCORS(resp.Header, origin)
					}
					defer resp.Body.Close()
					return resp.Write(conn)
				}
				return nil
			}
		}
		resp = errorResponse(req, err, http.StatusBadGateway)
		if errors.Is(err, scheduler.ErrNoAccountAvailable) {
			resp = errorResponse(req, err, http.StatusServiceUnavailable)
		}
	}
	// In MITM mode the browser still enforces CORS when JS on one
	// origin (e.g. x.com) fetches from another (api.x.com). Without
	// CORS headers on error/fast-fail responses the browser masks the
	// real error behind "CORS request did not succeed" / HTTP-0.
	if origin := req.Header.Get("Origin"); origin != "" {
		ensureCORS(resp.Header, origin)
	}
	defer resp.Body.Close()
	return resp.Write(conn)
}

func (s *Server) serveRelayed(w http.ResponseWriter, req *http.Request) {
	// Try streaming download first.
	sw := &httpResponseWriterAdapter{w: w}
	if handled, err := s.tryStreamDownload(req, sw); handled {
		if err != nil && !sw.written {
			status := http.StatusBadGateway
			if origin := req.Header.Get("Origin"); origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
			}
			http.Error(w, err.Error(), status)
		}
		return
	}

	resp, err := s.responseFor(req)
	if err != nil {
		// Safety net: if the relay reported the upstream response was too
		// large, retry as a chunked Range download.
		var tle *protocol.TooLargeError
		if errors.As(err, &tle) {
			swRetry := &httpResponseWriterAdapter{w: w}
			if handled, herr := s.tryStreamFromTooLarge(req, swRetry, tle); handled {
				if herr != nil && !swRetry.written {
					if origin := req.Header.Get("Origin"); origin != "" {
						w.Header().Set("Access-Control-Allow-Origin", origin)
						w.Header().Set("Access-Control-Allow-Credentials", "true")
						w.Header().Set("Vary", "Origin")
					}
					http.Error(w, herr.Error(), http.StatusBadGateway)
				}
				return
			}
		}
		status := http.StatusBadGateway
		if errors.Is(err, scheduler.ErrNoAccountAvailable) {
			status = http.StatusServiceUnavailable
		}
		// Set CORS on error responses so cross-origin fetches see the
		// real error instead of "CORS request did not succeed".
		if origin := req.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		http.Error(w, err.Error(), status)
		return
	}
	defer resp.Body.Close()
	origin := ""
	if s.cfg.InjectPermissiveCORS {
		origin = req.Header.Get("Origin")
	}
	writeHTTPResponse(w, resp, origin)
}

func (s *Server) responseFor(req *http.Request) (*http.Response, error) {
	start := time.Now()
	s.absoluteProxyURL(req)
	host := req.URL.Hostname()
	if s.router.IsBlocked(host) {
		return nil, fmt.Errorf("blocked by XenRelayProxy")
	}
	if host == "_proxy_stats" {
		return s.statsResponse(req), nil
	}
	if req.Method == http.MethodOptions && req.Header.Get("Access-Control-Request-Method") != "" {
		return corsPreflightResponse(req), nil
	}
	req.RequestURI = ""

	if s.isLongPollPath(req) {
		s.logs.Add(obs.LevelDebug, "longpoll",
			"fast-fail "+req.Method+" "+req.URL.String()+" (matches block_long_poll_paths)")
		return longPollFastFailResponse(req), nil
	}

	if cache.Cacheable(req) {
		if cached, ok := s.cache.Get(req.URL.String()); ok {
			s.metrics.Record(host, 0, cached.ContentLength, time.Since(start), nil)
			return cached, nil
		}
	}

	label := req.Method + " " + req.URL.Host + req.URL.Path
	logCookies(s.logs, label, req.Header)

	resp, err := s.relay.Do(req.Context(), req)
	if err != nil {
		s.logs.Add(obs.LevelWarn, "relay", req.Method+" "+req.URL.String()+" → "+err.Error())
		s.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, s.cfg.MaxResponseBodyBytes+1))
	_ = resp.Body.Close()
	if err != nil {
		s.logs.Add(obs.LevelError, "relay", fmt.Sprintf("%s %s → body read error: %s", req.Method, req.URL.String(), err.Error()))
		s.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	if int64(len(body)) > s.cfg.MaxResponseBodyBytes {
		err := fmt.Errorf("relay response too large [server-buffer]: %d bytes > max_response_body_bytes %d", len(body), s.cfg.MaxResponseBodyBytes)
		s.logs.Add(obs.LevelError, "relay", fmt.Sprintf("%s %s → %s", req.Method, req.URL.String(), err.Error()))
		s.metrics.Record(host, 0, 0, time.Since(start), err)
		return nil, err
	}
	logResponse(s.logs, label, resp, len(body), s.cfg)
	if cache.Cacheable(req) {
		s.cache.Put(req.URL.String(), resp, body, cache.TTL(resp, req.URL.String()))
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	s.metrics.Record(host, requestContentLength(req), int64(len(body)), time.Since(start), nil)
	return resp, nil
}

func (s *Server) statsResponse(req *http.Request) *http.Response {
	stats := map[string]any{
		"metrics": s.metrics.Snapshot(),
		"logs":    s.logs.Tail(200),
	}
	if s.scheduler != nil {
		stats["scheduler"] = s.scheduler.Stats()
	}
	body, _ := json.MarshalIndent(stats, "", "  ")
	return &http.Response{
		StatusCode:    http.StatusOK,
		Status:        "200 OK",
		Header:        http.Header{"Content-Type": []string{"application/json"}, "Content-Length": []string{strconv.Itoa(len(body))}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}
}

func (s *Server) absoluteProxyURL(req *http.Request) {
	if req.URL == nil || (req.URL.Scheme != "" && req.URL.Host != "") {
		return
	}
	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	req.URL.Scheme = "http"
	req.URL.Host = host
	req.RequestURI = ""
}

func (s *Server) absoluteRequestURL(req *http.Request, host, port string) {
	if req.URL == nil {
		return
	}
	if req.URL.Scheme == "" {
		if port == "443" {
			req.URL.Scheme = "https"
		} else {
			req.URL.Scheme = "http"
		}
	}
	if req.URL.Host == "" {
		req.URL.Host = host
		if port != "80" && port != "443" {
			req.URL.Host = net.JoinHostPort(host, port)
		}
	}
	req.RequestURI = ""
}

func (s *Server) doSNIRewrite(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.RequestURI = ""
	tr := &http.Transport{
		Proxy: nil,
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialer := &net.Dialer{
				Timeout:   time.Duration(s.cfg.TCPConnectTimeout) * time.Second,
				KeepAlive: 30 * time.Second,
			}
			raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(s.cfg.GoogleIP, "443"))
			if err != nil {
				return nil, err
			}
			tc := tls.Client(raw, &tls.Config{
				ServerName: clone.URL.Hostname(),
				MinVersion: tls.VersionTLS12,
				NextProtos: []string{"h2", "http/1.1"},
			})
			if err := tc.HandshakeContext(ctx); err != nil {
				_ = raw.Close()
				return nil, err
			}
			return tc, nil
		},
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: time.Duration(s.cfg.TLSConnectTimeout) * time.Second,
	}
	client := &http.Client{Transport: tr, Timeout: time.Duration(s.cfg.RelayTimeout) * time.Second}
	return client.Do(clone)
}

func (s *Server) directTunnel(target string, client net.Conn, buffered *bufio.Reader) {
	defer client.Close()
	upstream, err := net.DialTimeout("tcp", target, time.Duration(s.cfg.TCPConnectTimeout)*time.Second)
	if err != nil {
		level := obs.LevelWarn
		if strings.Contains(err.Error(), "connection refused") {
			level = obs.LevelDebug
		}
		s.logs.Add(level, "direct", "dial "+target+" failed: "+err.Error())
		return
	}
	defer upstream.Close()
	errc := make(chan error, 2)
	go func() {
		if buffered != nil && buffered.Buffered() > 0 {
			_, _ = buffered.WriteTo(upstream)
		}
		_, err := io.Copy(upstream, client)
		errc <- err
	}()
	go func() {
		_, err := io.Copy(client, upstream)
		errc <- err
	}()
	<-errc
}

// writeHTTPResponse forwards every upstream header verbatim. When
// `origin` is non-empty (caller opted into permissive CORS via
// `inject_permissive_cors`), the upstream Access-Control-* headers are
// stripped and replaced with a permissive set scoped to that origin.
//
// The default is to leave CORS alone: rewriting it can break legit
// cross-origin auth flows (Google OAuth, X.com login) where the
// upstream sets specific Allow-Origin/Allow-Credentials values that
// the browser cross-checks.
func writeHTTPResponse(w http.ResponseWriter, resp *http.Response, origin string) {
	overrideCORS := origin != ""
	for key, values := range resp.Header {
		if overrideCORS && strings.HasPrefix(strings.ToLower(key), "access-control-") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if overrideCORS {
		injectCORS(w.Header(), origin)
	}
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = io.Copy(w, resp.Body)
}

func corsPreflightResponse(req *http.Request) *http.Response {
	origin := req.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	header := http.Header{}
	header.Set("Access-Control-Allow-Origin", origin)
	header.Set("Access-Control-Allow-Methods", req.Header.Get("Access-Control-Request-Method"))
	header.Set("Access-Control-Allow-Headers", req.Header.Get("Access-Control-Request-Headers"))
	header.Set("Access-Control-Allow-Credentials", "true")
	header.Set("Access-Control-Max-Age", "86400")
	header.Set("Vary", "Origin")
	return &http.Response{
		StatusCode:    http.StatusNoContent,
		Status:        "204 No Content",
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(nil)),
		ContentLength: 0,
		Request:       req,
	}
}

// ensureCORS sets permissive CORS headers only if not already present
// in the response. Used on MITM error/fast-fail responses to prevent
// the browser from masking the real error behind "CORS request did not
// succeed". On successful upstream responses the headers are already
// set by the origin server and this function is a no-op.
func ensureCORS(h http.Header, origin string) {
	if h.Get("Access-Control-Allow-Origin") == "" {
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Vary", "Origin")
	}
}

func injectCORS(h http.Header, origin string) {
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "*")
	h.Set("Access-Control-Expose-Headers", "*")
	h.Set("Vary", "Origin")
}

func errorResponse(req *http.Request, err error, status int) *http.Response {
	body := []byte(err.Error() + "\n")
	return &http.Response{
		StatusCode:    status,
		Status:        strconv.Itoa(status) + " " + http.StatusText(status),
		Header:        http.Header{"Content-Type": []string{"text/plain; charset=utf-8"}, "Content-Length": []string{strconv.Itoa(len(body))}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}
}

func splitHostPortDefault(value, defaultPort string) (string, string, error) {
	if value == "" {
		return "", "", fmt.Errorf("empty host")
	}
	if strings.Contains(value, ":") {
		host, port, err := net.SplitHostPort(value)
		if err == nil {
			return strings.Trim(host, "[]"), port, nil
		}
		if strings.Count(value, ":") == 1 {
			parts := strings.Split(value, ":")
			return parts[0], parts[1], nil
		}
	}
	return strings.Trim(value, "[]"), defaultPort, nil
}

func shouldClose(h http.Header) bool {
	return strings.EqualFold(h.Get("Connection"), "close")
}

func requestContentLength(req *http.Request) int64 {
	if req == nil || req.ContentLength < 0 {
		return 0
	}
	return req.ContentLength
}

// logCookies emits a DEBUG-level summary of cookie-related headers on
// the request side: count of Cookie pairs + total byte size.
// (The response-side equivalent has been merged into logResponse so a
// single line per response shows everything we know about it.)
func logCookies(logs *obs.Ring, label string, h http.Header) {
	if logs == nil || h == nil {
		return
	}
	cookie := h.Get("Cookie")
	if cookie == "" {
		return
	}
	count := strings.Count(cookie, ";") + 1
	logs.Add(obs.LevelDebug, "cookie", fmt.Sprintf("%s — request Cookie: %d pair(s), %d bytes", label, count, len(cookie)))
}

// logResponse emits exactly one log entry per relay response containing
// everything diagnosable about the response in one line:
//
//   status=N body=Bb Set-Cookie=K names=[...] dbg=[...] | dbg=missing
//
// "dbg=missing" means Apps Script's reply envelope had no `_dbg`
// field, which almost always means the deployed Code.gs is older than
// the version in the repo and needs to be redeployed.
//
// Promoted to WARN when:
//   - An auth-shaped path returns zero Set-Cookies
//   - Zero cookies were forwarded to the upstream (ck=false)
//   - A redirect (302/303) has zero Set-Cookies (possible UrlFetchApp swallow)
//   - decoded_sc < sc (cookie loss in JSON transport layer)
func logResponse(logs *obs.Ring, label string, resp *http.Response, bodyLen int, cfg config.Config) {
	if logs == nil || resp == nil || resp.Header == nil {
		return
	}
	setCookies := resp.Header.Values("Set-Cookie")
	names := make([]string, 0, len(setCookies))
	for _, c := range setCookies {
		if eq := strings.Index(c, "="); eq > 0 {
			names = append(names, c[:eq])
		} else {
			names = append(names, "<malformed>")
		}
	}
	dbgHeader := resp.Header.Get(protocol.DebugHeader)
	resp.Header.Del(protocol.DebugHeader) // never leak to the browser
	dbgPart := "dbg=missing(redeploy_Code.gs?)"
	if dbgHeader != "" {
		dbgPart = "dbg=[" + dbgHeader + "]"
	}

	level := obs.LevelDebug

	// Promote to WARN on auth-like paths with zero Set-Cookies.
	if len(setCookies) == 0 && isAuthLikePath(label) {
		level = obs.LevelWarn
	}
	// Promote to WARN if Cookie header was not sent upstream on auth path.
	if dbgHeader != "" && strings.Contains(dbgHeader, "ck=false") && isAuthLikePath(label) {
		level = obs.LevelWarn
	}
	// Promote to WARN on redirects with zero Set-Cookies — possible
	// UrlFetchApp cookie jar interference.
	if len(setCookies) == 0 && (resp.StatusCode == 302 || resp.StatusCode == 303) {
		level = obs.LevelWarn
	}
	// Promote to WARN if Apps Script saw cookies but our decoder lost some.
	if dbgHeader != "" {
		if scIdx := strings.Index(dbgHeader, "sc="); scIdx >= 0 {
			var asSC int
			fmt.Sscanf(dbgHeader[scIdx:], "sc=%d", &asSC)
			if asSC > 0 && len(setCookies) < asSC {
				level = obs.LevelWarn
			}
		}
	}

	msg := fmt.Sprintf("%s — status=%d body=%db Set-Cookie=%d names=%v %s",
		label, resp.StatusCode, bodyLen, len(setCookies), names, dbgPart)
	logs.Add(level, "upstream", msg)

	// Verbose per-cookie logging when cookie_debug_mode is enabled.
	if cfg.CookieDebugMode && len(setCookies) > 0 {
		for i, sc := range setCookies {
			logs.Add(obs.LevelInfo, "cookie-debug",
				fmt.Sprintf("%s — Set-Cookie[%d]: %s", label, i, sc))
		}
	}
}

// isLongPollPath returns true if the request URL matches any
// configured long-poll / SSE / streaming path. These endpoints hold
// the upstream connection open until the relay timeout fires, which
// wedges the proxy and triggers broken-pipe errors back to the
// browser. Fast-failing them with 504 lets the page continue while
// long-poll-dependent features (live updates, presence) gracefully
// degrade.
func (s *Server) isLongPollPath(req *http.Request) bool {
	if req == nil || req.URL == nil || len(s.cfg.BlockLongPollPaths) == 0 {
		return false
	}
	full := req.URL.Host + req.URL.Path
	for _, pat := range s.cfg.BlockLongPollPaths {
		if pat == "" {
			continue
		}
		if strings.Contains(full, pat) {
			return true
		}
	}
	return false
}

func longPollFastFailResponse(req *http.Request) *http.Response {
	body := []byte("blocked: long-poll endpoint not supported through relay\n")
	h := http.Header{
		"Content-Type":   []string{"text/plain; charset=utf-8"},
		"Content-Length": []string{strconv.Itoa(len(body))},
	}
	// Include CORS so cross-origin long-poll fetches see a clean 504
	// instead of "CORS request did not succeed" / HTTP-0.
	if origin := req.Header.Get("Origin"); origin != "" {
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Vary", "Origin")
	}
	return &http.Response{
		StatusCode:    http.StatusGatewayTimeout,
		Status:        "504 Gateway Timeout",
		Header:        h,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}
}

// isAuthLikePath returns true for request labels that look like login /
// logout / auth / session endpoints. Used to flag when zero Set-Cookies
// come back on a path that almost certainly should have set them.
func isAuthLikePath(label string) bool {
	low := strings.ToLower(label)
	for _, hint := range []string{"login", "logout", "signin", "signout", "sign-in", "sign-out", "auth", "session", "/oauth", "/saml"} {
		if strings.Contains(low, hint) {
			return true
		}
	}
	return false
}
