package listener

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"xenrelayproxy/internal/config"
	"xenrelayproxy/internal/obs"
)

type fakeRelay struct{}

func (fakeRelay) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	body := []byte("ok:" + req.URL.String())
	return &http.Response{
		StatusCode:    http.StatusOK,
		Status:        "200 OK",
		Header:        http.Header{"Content-Type": []string{"text/plain"}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}, nil
}

func TestPlainHTTPRelaysAbsoluteURL(t *testing.T) {
	cfg := config.Config{ListenHost: "127.0.0.1", ListenPort: 18085, MaxResponseBodyBytes: 1024 * 1024}
	s := NewServer(cfg, fakeRelay{}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/path", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("http://example.com/path")) {
		t.Fatalf("unexpected body %q", w.Body.String())
	}
}

// By default the proxy must NOT rewrite the upstream's Access-Control-*
// headers. Doing so breaks legit cross-origin auth (Google OAuth, X.com
// login) where the upstream sets specific Allow-Origin/Allow-Credentials.
func TestCORSPassThroughByDefault(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	upstreamCORS := upstreamWithCORS{
		allowOrigin:      "https://allowed.example",
		allowCredentials: "true",
	}
	s := NewServer(cfg, upstreamCORS, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/auth", nil)
	req.Header.Set("Origin", "https://attacker.example")
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://allowed.example" {
		t.Fatalf("upstream Allow-Origin should pass through verbatim, got %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("upstream Allow-Credentials should pass through, got %q", got)
	}
}

// Power users can re-enable the legacy permissive override via
// inject_permissive_cors: true. When set, the upstream's CORS headers
// are stripped and replaced with the broad allow set (the old behavior).
func TestCORSPermissiveOverrideOptIn(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024, InjectPermissiveCORS: true}
	upstreamCORS := upstreamWithCORS{
		allowOrigin:      "https://allowed.example",
		allowCredentials: "true",
	}
	s := NewServer(cfg, upstreamCORS, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/auth", nil)
	req.Header.Set("Origin", "https://app.example")
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example" {
		t.Fatalf("opt-in mode should reflect request Origin, got %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("opt-in mode should set Allow-Credentials, got %q", got)
	}
}

// Multi-value Set-Cookie from upstream must reach the browser as separate
// headers, not collapsed into one comma-joined value (which would
// break login flows that rely on ;-separated cookie attributes).
func TestSetCookiePassThrough(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	upstream := upstreamWithSetCookies{
		cookies: []string{
			"session=abc; Path=/; HttpOnly",
			"csrf=xyz; Path=/; SameSite=Lax",
		},
	}
	s := NewServer(cfg, upstream, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/login", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	cookies := w.Header().Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("expected 2 Set-Cookie headers, got %d: %#v", len(cookies), cookies)
	}
}

type upstreamWithCORS struct {
	allowOrigin      string
	allowCredentials string
}

func (u upstreamWithCORS) Do(_ context.Context, req *http.Request) (*http.Response, error) {
	h := http.Header{
		"Content-Type":                     []string{"text/html"},
		"Access-Control-Allow-Origin":      []string{u.allowOrigin},
		"Access-Control-Allow-Credentials": []string{u.allowCredentials},
	}
	body := []byte("ok")
	return &http.Response{
		StatusCode: http.StatusOK, Status: "200 OK",
		Header: h,
		Body:   io.NopCloser(bytes.NewReader(body)),
		Request: req,
	}, nil
}

type upstreamWithSetCookies struct{ cookies []string }

func (u upstreamWithSetCookies) Do(_ context.Context, req *http.Request) (*http.Response, error) {
	h := http.Header{"Content-Type": []string{"text/html"}}
	for _, c := range u.cookies {
		h.Add("Set-Cookie", c)
	}
	body := []byte("ok")
	return &http.Response{
		StatusCode: http.StatusOK, Status: "200 OK",
		Header: h,
		Body:   io.NopCloser(bytes.NewReader(body)),
		Request: req,
	}, nil
}

func TestCORSPreflight(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	s := NewServer(cfg, fakeRelay{}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodOptions, "http://example.com/path", nil)
	req.Header.Set("Origin", "https://app.example")
	req.Header.Set("Access-Control-Request-Method", "POST")
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "https://app.example" {
		t.Fatalf("missing CORS headers: %#v", w.Header())
	}
}

func TestStatsEndpoint(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	s := NewServer(cfg, fakeRelay{}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://_proxy_stats/", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("metrics")) {
		t.Fatalf("stats missing metrics: %s", w.Body.String())
	}
}

type rangeRelay struct{ data []byte }

func (r rangeRelay) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	rangeHeader := req.Header.Get("Range")
	if rangeHeader == "" {
		return &http.Response{
			StatusCode:    http.StatusOK,
			Status:        "200 OK",
			Header:        http.Header{"Content-Type": []string{"application/octet-stream"}},
			Body:          io.NopCloser(bytes.NewReader(r.data)),
			ContentLength: int64(len(r.data)),
			Request:       req,
		}, nil
	}
	start, end := parseRangeForTest(rangeHeader)
	if end >= int64(len(r.data)) {
		end = int64(len(r.data)) - 1
	}
	part := r.data[start : end+1]
	return &http.Response{
		StatusCode: http.StatusPartialContent,
		Status:     "206 Partial Content",
		Header: http.Header{
			"Content-Type":  []string{"application/octet-stream"},
			"Content-Range": []string{fmt.Sprintf("bytes %d-%d/%d", start, end, len(r.data))},
		},
		Body:          io.NopCloser(bytes.NewReader(part)),
		ContentLength: int64(len(part)),
		Request:       req,
	}, nil
}

// Long-poll endpoints (api.x.com/live_pipeline, etc.) hold the upstream
// open for ~30s and would exhaust the relay timeout. The listener must
// fast-fail them with 504 before they reach the relay.
func TestLongPollFastFail(t *testing.T) {
	cfg := config.Config{
		MaxResponseBodyBytes: 1024 * 1024,
		BlockLongPollPaths:   []string{"api.x.com/live_pipeline/events"},
	}
	relayed := false
	relay := relayHook{onDo: func() { relayed = true }}
	s := NewServer(cfg, relay, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://api.x.com/live_pipeline/events?topic=foo", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d", w.Code)
	}
	if relayed {
		t.Fatal("long-poll path must not reach the relay")
	}
}

func TestNonLongPollPathStillRelays(t *testing.T) {
	cfg := config.Config{
		MaxResponseBodyBytes: 1024 * 1024,
		BlockLongPollPaths:   []string{"api.x.com/live_pipeline/events"},
	}
	relayed := false
	relay := relayHook{onDo: func() { relayed = true }}
	s := NewServer(cfg, relay, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://x.com/home", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if !relayed {
		t.Fatal("non-matching path must reach the relay")
	}
}

type relayHook struct{ onDo func() }

func (r relayHook) Do(_ context.Context, req *http.Request) (*http.Response, error) {
	if r.onDo != nil {
		r.onDo()
	}
	body := []byte("ok")
	return &http.Response{
		StatusCode: http.StatusOK, Status: "200 OK",
		Header: http.Header{"Content-Type": []string{"text/plain"}},
		Body:   io.NopCloser(bytes.NewReader(body)),
		Request: req,
	}, nil
}

func TestMITMModeForSNIRewriteHost(t *testing.T) {
	cfg := config.Config{SNIRewriteHosts: []string{"youtube.com"}}
	s := NewServer(cfg, fakeRelay{}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	if got := s.mitmModeFor("www.youtube.com"); got != MITMSNIRewrite {
		t.Fatalf("expected MITMSNIRewrite for youtube, got %v", got)
	}
	if got := s.mitmModeFor("example.com"); got != MITMRelay {
		t.Fatalf("expected MITMRelay for non-listed host, got %v", got)
	}
}

func TestMITMModeForForceRelayOverride(t *testing.T) {
	cfg := config.Config{
		SNIRewriteHosts:    []string{"youtube.com"},
		ForceRelaySNIHosts: true,
	}
	s := NewServer(cfg, fakeRelay{}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	if got := s.mitmModeFor("www.youtube.com"); got != MITMRelay {
		t.Fatalf("force_relay_sni_hosts should send youtube via relay, got %v", got)
	}
}

func TestChunkedDownload(t *testing.T) {
	data := bytes.Repeat([]byte("a"), 2048)
	cfg := config.Config{
		MaxResponseBodyBytes: 4096,
		DownloadMinSize:      1024,
		DownloadChunkSize:    512,
		DownloadMaxParallel:  2,
		DownloadMaxChunks:    8,
		DownloadExtensions:   []string{".bin"},
		TCPConnectTimeout:    1,
		TLSConnectTimeout:    1,
		RelayTimeout:         1,
	}
	s := NewServer(cfg, rangeRelay{data: data}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/file.bin", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatalf("download body mismatch: got %d want %d", w.Body.Len(), len(data))
	}
}

func parseRangeForTest(value string) (int64, int64) {
	value = strings.TrimPrefix(value, "bytes=")
	parts := strings.Split(value, "-")
	start, _ := strconv.ParseInt(parts[0], 10, 64)
	end, _ := strconv.ParseInt(parts[1], 10, 64)
	return start, end
}

// Cookie deletion headers (Set-Cookie with Expires in the past) must
// be forwarded to the browser exactly as received, so the browser
// removes the named cookie. This is critical for logout flows.
func TestCookieDeletionHeadersPreserved(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	upstream := upstreamWithSetCookies{
		cookies: []string{
			"session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly",
			"csrf=; Max-Age=0; Path=/",
		},
	}
	s := NewServer(cfg, upstream, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/logout", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	cookies := w.Header().Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("expected 2 cookie deletion headers, got %d: %#v", len(cookies), cookies)
	}
	if !strings.Contains(cookies[0], "Expires=Thu, 01 Jan 1970") {
		t.Fatalf("first cookie should preserve Expires date, got %q", cookies[0])
	}
	if !strings.Contains(cookies[1], "Max-Age=0") {
		t.Fatalf("second cookie should preserve Max-Age, got %q", cookies[1])
	}
}

// Set-Cookie with Expires containing commas (e.g. "Mon, 01 Jan 2030")
// must not be split across multiple Set-Cookie headers.
func TestSetCookieWithExpiresCommaPreserved(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	upstream := upstreamWithSetCookies{
		cookies: []string{
			"session=abc123; Expires=Mon, 01 Jan 2030 00:00:00 GMT; Path=/; HttpOnly; Secure",
			"prefs=dark; Expires=Fri, 31 Dec 2027 23:59:59 GMT; Path=/",
		},
	}
	s := NewServer(cfg, upstream, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/login", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	cookies := w.Header().Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("expected 2 Set-Cookie headers, got %d: %#v", len(cookies), cookies)
	}
	if !strings.Contains(cookies[0], "session=abc123") {
		t.Fatalf("first cookie corrupted: %q", cookies[0])
	}
	if !strings.Contains(cookies[1], "prefs=dark") {
		t.Fatalf("second cookie corrupted: %q", cookies[1])
	}
}

// The X-Xenrelay-Debug header must never reach the browser.
func TestDebugHeaderStrippedFromResponse(t *testing.T) {
	cfg := config.Config{MaxResponseBodyBytes: 1024 * 1024}
	upstream := upstreamWithDebugHeader{}
	s := NewServer(cfg, upstream, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/path", nil)
	w := httptest.NewRecorder()
	s.handleHTTPProxy(w, req)
	if w.Header().Get("X-Xenrelay-Debug") != "" {
		t.Fatal("debug header leaked to browser")
	}
}

type upstreamWithDebugHeader struct{}

func (upstreamWithDebugHeader) Do(_ context.Context, req *http.Request) (*http.Response, error) {
	h := http.Header{
		"Content-Type":     []string{"text/plain"},
		"X-Xenrelay-Debug": []string{"sc=2 hk=5 cl=42 ck=true decoded_sc=2 h_sc=2 c_len=2"},
	}
	body := []byte("ok")
	return &http.Response{
		StatusCode: http.StatusOK, Status: "200 OK",
		Header: h,
		Body:   io.NopCloser(bytes.NewReader(body)),
		Request: req,
	}, nil
}

// cookie_critical_hosts entries should be routed via SNI-rewrite.
func TestCookieCriticalHostsRouteViaSNIRewrite(t *testing.T) {
	cfg := config.Config{CookieCriticalHosts: []string{"login.example.com"}}
	s := NewServer(cfg, fakeRelay{}, nil, nil, obs.NewMetrics(), obs.NewRing(10), nil)
	if got := s.mitmModeFor("login.example.com"); got != MITMSNIRewrite {
		t.Fatalf("cookie_critical_hosts should use SNI rewrite, got %v", got)
	}
	if got := s.mitmModeFor("other.example.com"); got != MITMRelay {
		t.Fatalf("non-critical host should use relay, got %v", got)
	}
}
