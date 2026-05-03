package protocol

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func rawHeaders(t *testing.T, m map[string]any) map[string]json.RawMessage {
	t.Helper()
	out := map[string]json.RawMessage{}
	for k, v := range m {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("marshal %s: %v", k, err)
		}
		out[k] = b
	}
	return out
}

func TestBuildEnvelopeStripsSensitiveHeaders(t *testing.T) {
	req, err := http.NewRequest("POST", "https://example.com/path", strings.NewReader("hello"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-For", "127.0.0.1")
	req.Header.Set("User-Agent", "test")
	req.Header.Set("Content-Type", "text/plain")
	env, err := BuildEnvelope(req, "key", 1024)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := env.H["X-Forwarded-For"]; ok {
		t.Fatal("sensitive header was forwarded")
	}
	if env.H["User-Agent"] != "test" {
		t.Fatalf("missing user-agent: %#v", env.H)
	}
	if env.B == "" || env.CT != "text/plain" {
		t.Fatalf("body metadata not set: %#v", env)
	}
}

func TestFlattenHeadersJoinsCookieWithSemicolon(t *testing.T) {
	h := http.Header{}
	h.Add("Cookie", "a=1")
	h.Add("Cookie", "b=2")
	h.Add("Accept", "text/html")
	h.Add("Accept", "application/json")
	out := FlattenHeaders(h)
	if out["Cookie"] != "a=1; b=2" {
		t.Fatalf("Cookie should join with \"; \", got %q", out["Cookie"])
	}
	if out["Accept"] != "text/html, application/json" {
		t.Fatalf("Accept should join with \", \", got %q", out["Accept"])
	}
}

func TestParseBatchUsesCleanV2RArray(t *testing.T) {
	replies, err := ParseBatch([]byte(`{"r":[{"s":200,"h":{},"b":""}]}`), 1)
	if err != nil {
		t.Fatal(err)
	}
	if replies[0].S != 200 {
		t.Fatalf("bad status: %#v", replies[0])
	}
	if _, err := ParseBatch([]byte(`{"q":[{"s":200}]}`), 1); err == nil {
		t.Fatal("expected old q response shape to be rejected")
	}
}

func TestResponseFromReplySingleStringHeader(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	resp, err := ResponseFromReply(req, Reply{
		S: 201,
		H: rawHeaders(t, map[string]any{"content-type": "text/plain"}),
		B: "aGk=",
	})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 201 || string(body) != "hi" {
		t.Fatalf("unexpected response: %d %q", resp.StatusCode, string(body))
	}
	if resp.Header.Get("Content-Type") != "text/plain" {
		t.Fatalf("missing content-type: %#v", resp.Header)
	}
}

// Apps Script returns multi-valued headers (notably Set-Cookie on login
// flows) as a JSON array. Before the protocol fix this collapsed the
// reply to a parse error and broke every login that set 2+ cookies.
func TestResponseFromReplyMultipleSetCookies(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/login", nil)
	resp, err := ResponseFromReply(req, Reply{
		S: 200,
		H: rawHeaders(t, map[string]any{
			"set-cookie": []string{
				"session=abc; Path=/; HttpOnly; Secure",
				"csrf=xyz; Path=/; SameSite=Lax",
			},
			"content-type": "text/html",
		}),
		B: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	cookies := resp.Header.Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("expected 2 Set-Cookie headers, got %d: %#v", len(cookies), cookies)
	}
	if !strings.Contains(cookies[0], "session=abc") || !strings.Contains(cookies[1], "csrf=xyz") {
		t.Fatalf("Set-Cookie order/content wrong: %#v", cookies)
	}
}

func TestParseSingleAcceptsMultiCookieReply(t *testing.T) {
	body := []byte(`{"s":200,"h":{"set-cookie":["a=1","b=2"],"content-type":"text/html"},"b":""}`)
	reply, err := ParseSingle(body)
	if err != nil {
		t.Fatalf("ParseSingle should accept multi-value header arrays: %v", err)
	}
	if reply.S != 200 {
		t.Fatalf("bad status: %d", reply.S)
	}
	values := DecodeHeaderValues(reply.H["set-cookie"])
	if len(values) != 2 {
		t.Fatalf("expected 2 cookies after decode, got %d", len(values))
	}
}

func TestDecodeHeaderValuesShapes(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"string", `"hello"`, []string{"hello"}},
		{"array", `["a","b"]`, []string{"a", "b"}},
		{"empty array", `[]`, []string{}},
		{"null", `null`, nil},
		{"number", `42`, []string{"42"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DecodeHeaderValues(json.RawMessage(tc.raw))
			if len(got) != len(tc.want) {
				t.Fatalf("got %#v want %#v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("idx %d: got %q want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// SplitSetCookieString is the Go-side safety net for comma-joined
// Set-Cookie strings. It must correctly split cookies while preserving
// Expires dates that contain commas.
func TestSplitSetCookieString(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{
			name: "single cookie no expires",
			in:   "session=abc; Path=/; HttpOnly",
			want: []string{"session=abc; Path=/; HttpOnly"},
		},
		{
			name: "two cookies no expires",
			in:   "session=abc; Path=/, csrf=xyz; Path=/",
			want: []string{"session=abc; Path=/", "csrf=xyz; Path=/"},
		},
		{
			name: "two cookies with expires dates",
			in:   "session=abc; Expires=Mon, 01 Jan 2030 00:00:00 GMT; Path=/, csrf=xyz; Expires=Fri, 31 Dec 2027 23:59:59 GMT; Path=/",
			want: []string{
				"session=abc; Expires=Mon, 01 Jan 2030 00:00:00 GMT; Path=/",
				"csrf=xyz; Expires=Fri, 31 Dec 2027 23:59:59 GMT; Path=/",
			},
		},
		{
			name: "cookie deletion with past expires",
			in:   "session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/, csrf=abc; Path=/",
			want: []string{
				"session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
				"csrf=abc; Path=/",
			},
		},
		{
			name: "cookie with max-age after comma",
			in:   "session=abc; Expires=Mon, 01 Jan 2030 00:00:00 GMT; Max-Age=86400; Path=/",
			want: []string{"session=abc; Expires=Mon, 01 Jan 2030 00:00:00 GMT; Max-Age=86400; Path=/"},
		},
		{
			name: "three cookies with mixed attributes",
			in:   "a=1; Path=/, b=2; Domain=.example.com; Secure, c=3; SameSite=Lax",
			want: []string{
				"a=1; Path=/",
				"b=2; Domain=.example.com; Secure",
				"c=3; SameSite=Lax",
			},
		},
		{
			name: "empty string",
			in:   "",
			want: []string{},
		},
		{
			name: "single cookie only",
			in:   "token=abc123",
			want: []string{"token=abc123"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SplitSetCookieString(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("got %d cookies %#v, want %d %#v", len(got), got, len(tc.want), tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("cookie[%d]: got %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// Protocol v2.1: when the C field is present, it should be used as the
// authoritative source for Set-Cookie, ignoring the H map's set-cookie entry.
func TestResponseFromReplyUsesCFieldForSetCookie(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/login", nil)
	resp, err := ResponseFromReply(req, Reply{
		S: 200,
		H: rawHeaders(t, map[string]any{
			"content-type": "text/html",
			// This set-cookie in H should be IGNORED when C is present.
			"set-cookie": "stale=old; Path=/",
		}),
		C: []string{
			"session=abc; Path=/; HttpOnly; Secure",
			"csrf=xyz; Path=/; SameSite=Lax",
		},
		B: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	cookies := resp.Header.Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("expected 2 Set-Cookie from C field, got %d: %#v", len(cookies), cookies)
	}
	if !strings.Contains(cookies[0], "session=abc") {
		t.Fatalf("first cookie should be from C field, got %q", cookies[0])
	}
	if !strings.Contains(cookies[1], "csrf=xyz") {
		t.Fatalf("second cookie should be from C field, got %q", cookies[1])
	}
	// Verify the stale H entry was NOT included.
	for _, c := range cookies {
		if strings.Contains(c, "stale=old") {
			t.Fatalf("H map set-cookie should be ignored when C is present, found %q", c)
		}
	}
}

// When C field is absent (old Code.gs), Set-Cookie should still come from H.
func TestResponseFromReplyFallsBackToHWhenCAbsent(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/login", nil)
	resp, err := ResponseFromReply(req, Reply{
		S: 200,
		H: rawHeaders(t, map[string]any{
			"content-type": "text/html",
			"set-cookie": []string{
				"session=abc; Path=/",
				"csrf=xyz; Path=/",
			},
		}),
		// C is nil — simulating old Code.gs that doesn't populate it.
		B: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	cookies := resp.Header.Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("expected 2 Set-Cookie from H fallback, got %d: %#v", len(cookies), cookies)
	}
}

// When H contains a comma-joined Set-Cookie string (from getHeaders()
// fallback), the Go-side splitter must break it apart correctly.
func TestResponseFromReplySplitsCommaJoinedSetCookie(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/login", nil)
	// Simulate what happens when getHeaders() comma-joins two cookies.
	joined := "session=abc; Expires=Mon, 01 Jan 2030 00:00:00 GMT; Path=/, csrf=xyz; Path=/"
	resp, err := ResponseFromReply(req, Reply{
		S: 200,
		H: rawHeaders(t, map[string]any{
			"content-type": "text/html",
			"set-cookie":   joined,
		}),
		B: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	cookies := resp.Header.Values("Set-Cookie")
	if len(cookies) != 2 {
		t.Fatalf("Go-side splitter should split comma-joined cookies, got %d: %#v", len(cookies), cookies)
	}
	if !strings.Contains(cookies[0], "session=abc") {
		t.Fatalf("first cookie wrong: %q", cookies[0])
	}
	if !strings.Contains(cookies[1], "csrf=xyz") {
		t.Fatalf("second cookie wrong: %q", cookies[1])
	}
}

// The debug header must use case-insensitive matching for set-cookie keys.
func TestResponseFromReplyDebugHeaderCaseInsensitive(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/login", nil)
	// Use unusual casing that neither "set-cookie" nor "Set-Cookie" matches directly.
	resp, err := ResponseFromReply(req, Reply{
		S: 200,
		H: rawHeaders(t, map[string]any{
			"Set-cookie": []string{"a=1", "b=2"},
		}),
		D: &ReplyDebug{SetCookieCount: 2, HeaderCount: 1},
		B: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	dbg := resp.Header.Get(DebugHeader)
	if dbg == "" {
		t.Fatal("debug header missing")
	}
	// decoded_sc should be 2 regardless of header key casing.
	if !strings.Contains(dbg, "decoded_sc=2") {
		t.Fatalf("debug should report decoded_sc=2, got %q", dbg)
	}
}
