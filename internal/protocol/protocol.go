package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
)

type Envelope struct {
	K  string            `json:"k,omitempty"`
	U  string            `json:"u,omitempty"`
	M  string            `json:"m,omitempty"`
	H  map[string]string `json:"h,omitempty"`
	B  string            `json:"b,omitempty"`
	CT string            `json:"ct,omitempty"`
	R  *bool             `json:"r,omitempty"`
	Q  []Envelope        `json:"q,omitempty"`
}

// Reply uses RawMessage for header values so we can accept either a single
// string ({"set-cookie": "a=1"}) or an array ({"set-cookie": ["a=1", "b=2"]}).
// Apps Script's HTTPResponse.getAllHeaders() returns arrays for any header
// that has multiple values (notably Set-Cookie on most login flows). The
// previous map[string]string declaration silently failed JSON-decoding for
// any such response.
type Reply struct {
	S int                        `json:"s,omitempty"`
	H map[string]json.RawMessage `json:"h,omitempty"`
	C []string                   `json:"c,omitempty"` // v2.1: explicit Set-Cookie array
	B string                     `json:"b,omitempty"`
	E string                     `json:"e,omitempty"`
	R []Reply                    `json:"r,omitempty"`
	D *ReplyDebug                `json:"d,omitempty"`
}

// ReplyDebug carries diagnostic counters that Apps Script populates so
// the Go side can tell whether cookie loss happens upstream (Apps
// Script never received them, or sent the request without a Cookie
// header) or in our protocol decoder.
type ReplyDebug struct {
	SetCookieCount     int  `json:"sc,omitempty"`
	HeaderCount        int  `json:"hk,omitempty"`
	OutboundCookieLen  int  `json:"cl,omitempty"`
	OutboundCookieSent bool `json:"ck,omitempty"`
}

// DebugHeader is a synthetic response header carrying Apps Script's
// _dbg counters for in-process diagnostics. Stripped by the listener
// before forwarding the response to the browser.
const DebugHeader = "X-Xenrelay-Debug"

// DecodeHeaderValues parses a header value that arrived as either a JSON
// string or a JSON array of strings. null / numbers / bools coerce to a
// single string. Unknown shapes are dropped.
func DecodeHeaderValues(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	switch raw[0] {
	case '"':
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			return []string{s}
		}
	case '[':
		var arr []string
		if err := json.Unmarshal(raw, &arr); err == nil {
			return arr
		}
		// Fall through: array of mixed types — coerce element-by-element.
		var anyArr []any
		if err := json.Unmarshal(raw, &anyArr); err == nil {
			out := make([]string, 0, len(anyArr))
			for _, v := range anyArr {
				if v == nil {
					continue
				}
				out = append(out, fmt.Sprint(v))
			}
			return out
		}
	case 'n':
		return nil
	default:
		// Number / bool — coerce to its JSON literal form.
		return []string{strings.TrimSpace(string(raw))}
	}
	return nil
}

var StripHeaders = map[string]struct{}{
	"accept-encoding":     {},
	"x-forwarded-for":     {},
	"x-forwarded-host":    {},
	"x-forwarded-proto":   {},
	"x-forwarded-port":    {},
	"x-real-ip":           {},
	"forwarded":           {},
	"via":                 {},
	"proxy-authorization": {},
	"proxy-connection":    {},
	"connection":          {},
	"keep-alive":          {},
	"transfer-encoding":   {},
	"te":                  {},
	"trailer":             {},
	"upgrade":             {},
	"host":                {},
	"content-length":      {},
	"content-encoding":    {},
}

func BuildEnvelope(req *http.Request, authKey string, maxBody int64) (Envelope, error) {
	if req.URL == nil {
		return Envelope{}, fmt.Errorf("request URL is nil")
	}
	if req.URL.Scheme == "" || req.URL.Host == "" {
		return Envelope{}, fmt.Errorf("request URL must be absolute")
	}
	body, err := readBody(req.Body, maxBody)
	if err != nil {
		return Envelope{}, err
	}
	followRedirects := false
	env := Envelope{
		K: authKey,
		U: req.URL.String(),
		M: req.Method,
		H: FlattenHeaders(req.Header),
		R: &followRedirects,
	}
	if len(body) > 0 {
		env.B = base64.StdEncoding.EncodeToString(body)
		if ct := req.Header.Get("Content-Type"); ct != "" {
			env.CT = ct
		} else if detected := http.DetectContentType(body); detected != "" {
			if mediaType, _, err := mime.ParseMediaType(detected); err == nil {
				env.CT = mediaType
			}
		}
	}
	return env, nil
}

func FlattenHeaders(headers http.Header) map[string]string {
	out := map[string]string{}
	for key, values := range headers {
		canon := textproto.CanonicalMIMEHeaderKey(key)
		if _, skip := StripHeaders[strings.ToLower(canon)]; skip {
			continue
		}
		if len(values) == 0 {
			continue
		}
		// RFC 6265 §5.4: Cookie pairs are separated by "; ", not ",".
		// Browsers normally send a single Cookie header value, but if a
		// client sends multiple we must join with the cookie separator
		// so the upstream parses them correctly.
		sep := ", "
		if canon == "Cookie" {
			sep = "; "
		}
		out[canon] = strings.Join(values, sep)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func ParseSingle(data []byte) (Reply, error) {
	var reply Reply
	if err := json.Unmarshal(data, &reply); err != nil {
		return Reply{}, err
	}
	if reply.E != "" {
		if reply.E == "too_large" {
			return reply, &TooLargeError{
				Size:    extractSizeFromReply(data, reply),
				Headers: replyHeadersToHTTPHeader(reply.H),
			}
		}
		return reply, RelayError(reply.E)
	}
	if reply.S == 0 {
		return Reply{}, fmt.Errorf("relay reply missing status")
	}
	return reply, nil
}

// replyHeadersToHTTPHeader best-effort decodes the H map into http.Header
// so callers (e.g. chunked-download retry) can read upstream metadata.
func replyHeadersToHTTPHeader(h map[string]json.RawMessage) http.Header {
	if len(h) == 0 {
		return nil
	}
	out := http.Header{}
	for k, raw := range h {
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			out.Set(k, s)
			continue
		}
		var arr []string
		if err := json.Unmarshal(raw, &arr); err == nil {
			for _, v := range arr {
				out.Add(k, v)
			}
		}
	}
	return out
}

func ParseBatch(data []byte, expected int) ([]Reply, error) {
	var reply Reply
	if err := json.Unmarshal(data, &reply); err != nil {
		return nil, err
	}
	if reply.E != "" {
		return nil, RelayError(reply.E)
	}
	if reply.R == nil {
		return nil, fmt.Errorf("batch reply missing v2 r array")
	}
	if len(reply.R) != expected {
		return nil, fmt.Errorf("batch reply size mismatch: got %d want %d", len(reply.R), expected)
	}
	return reply.R, nil
}

// cookieAttrs are known Set-Cookie attribute names. Used by
// SplitSetCookieString to avoid splitting on commas inside attribute
// values (notably the Expires date which always contains a comma).
var cookieAttrs = map[string]struct{}{
	"expires":     {},
	"max-age":     {},
	"path":        {},
	"domain":      {},
	"samesite":    {},
	"secure":      {},
	"httponly":     {},
	"partitioned": {},
}

// SplitSetCookieString splits a comma-joined Set-Cookie string into
// individual cookie strings. This is the Go-side safety net for cases
// where Apps Script's getHeaders() returned a collapsed string that the
// JS-side splitter missed (or an old Code.gs deployment lacks the fix).
//
// The heuristic: split on commas only when followed by a token=value
// pattern where the token is NOT a known Set-Cookie attribute.
func SplitSetCookieString(joined string) []string {
	var parts []string
	idx := 0
	for idx < len(joined) {
		nextComma := -1
		probe := idx
		for {
			c := strings.Index(joined[probe:], ",")
			if c < 0 {
				break
			}
			c += probe // absolute index
			// After the comma, skip whitespace.
			p := c + 1
			for p < len(joined) && joined[p] == ' ' {
				p++
			}
			// Look for `name=` where name has no spaces/commas/semicolons.
			eq := strings.Index(joined[p:], "=")
			if eq > 0 {
				name := joined[p : p+eq]
				if !strings.ContainsAny(name, " \t,;") {
					// If the name is a known cookie attribute, this comma
					// is inside the cookie — not a boundary.
					if _, isAttr := cookieAttrs[strings.ToLower(name)]; isAttr {
						probe = c + 1
						continue
					}
					nextComma = c
					break
				}
			}
			probe = c + 1
		}
		if nextComma < 0 {
			parts = append(parts, strings.TrimSpace(joined[idx:]))
			break
		}
		parts = append(parts, strings.TrimSpace(joined[idx:nextComma]))
		idx = nextComma + 1
	}
	// Filter empty strings.
	out := parts[:0]
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ResponseFromReply(req *http.Request, reply Reply) (*http.Response, error) {
	if reply.E != "" {
		return nil, RelayError(reply.E)
	}
	status := reply.S
	if status == 0 {
		status = http.StatusBadGateway
	}
	body, err := base64.StdEncoding.DecodeString(reply.B)
	if err != nil {
		return nil, fmt.Errorf("decode relay body: %w", err)
	}
	header := http.Header{}

	// Track whether we used the dedicated C field for Set-Cookie so we
	// can skip any set-cookie entries in the generic H map.
	usedCField := len(reply.C) > 0
	if usedCField {
		for _, sc := range reply.C {
			header.Add("Set-Cookie", sc)
		}
	}

	for key, raw := range reply.H {
		if key == "" {
			continue
		}
		canon := textproto.CanonicalMIMEHeaderKey(key)
		// If we already populated Set-Cookie from C, skip the H entry.
		if usedCField && strings.EqualFold(canon, "Set-Cookie") {
			continue
		}
		values := DecodeHeaderValues(raw)
		// Go-side safety net: if Set-Cookie decoded as a single
		// comma-containing string, it was likely comma-joined by
		// getHeaders(). Re-split it.
		if strings.EqualFold(canon, "Set-Cookie") && len(values) == 1 && strings.Contains(values[0], ",") {
			values = SplitSetCookieString(values[0])
		}
		for _, value := range values {
			header.Add(canon, value)
		}
	}

	header.Del("Content-Length")
	header.Del("Transfer-Encoding")
	header.Set("Content-Length", strconv.Itoa(len(body)))

	// Stash Apps Script's diagnostic counters on a non-forwarded header
	// so the listener's logging path can compare what AS saw vs. what
	// our decoder produced. Stripped before the response leaves the
	// proxy (see writeHTTPResponse / shouldStripDebugHeader).
	if reply.D != nil {
		decoded := len(header.Values("Set-Cookie"))
		// Case-insensitive scan of H for the raw Set-Cookie count from
		// the JSON, in case the C field was used or casing varied.
		rawFromH := 0
		for k, raw := range reply.H {
			if strings.EqualFold(k, "set-cookie") {
				rawFromH = len(DecodeHeaderValues(raw))
				break
			}
		}
		header.Set(DebugHeader, fmt.Sprintf("sc=%d hk=%d cl=%d ck=%t decoded_sc=%d h_sc=%d c_len=%d",
			reply.D.SetCookieCount, reply.D.HeaderCount, reply.D.OutboundCookieLen,
			reply.D.OutboundCookieSent, decoded, rawFromH, len(reply.C)))
	}
	return &http.Response{
		StatusCode:    status,
		Status:        fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}, nil
}

type RelayError string

func (e RelayError) Error() string { return string(e) }

// TooLargeError is returned by ParseSingle / ParseBatch when the relay
// server signals that the upstream response exceeded its per-call cap
// (e: "too_large"). It carries the upstream-declared size (taken from
// the relay's `size` field, falling back to the Content-Length header
// in the H map) so callers can attempt a chunked retry.
type TooLargeError struct {
	Size    int64
	Headers http.Header
}

func (e *TooLargeError) Error() string {
	if e == nil {
		return "too_large"
	}
	if e.Size > 0 {
		return fmt.Sprintf("too_large: upstream response is %d bytes (relay per-call cap exceeded)", e.Size)
	}
	return "too_large: upstream response exceeds relay per-call cap"
}

// extractSizeFromReply returns the upstream-declared size from a too_large
// reply. Prefers the relay's `size` numeric field if present, then falls
// back to Content-Length in the H map.
func extractSizeFromReply(raw []byte, reply Reply) int64 {
	// Try parsing top-level "size" field first — relay.py emits it as a
	// JSON number alongside the e/h fields.
	var sized struct {
		Size int64 `json:"size"`
	}
	if err := json.Unmarshal(raw, &sized); err == nil && sized.Size > 0 {
		return sized.Size
	}
	// Fall back to Content-Length header.
	if reply.H != nil {
		for k, raw := range reply.H {
			if !strings.EqualFold(k, "content-length") {
				continue
			}
			var s string
			if err := json.Unmarshal(raw, &s); err == nil {
				if v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil && v > 0 {
					return v
				}
			}
			var arr []string
			if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
				if v, err := strconv.ParseInt(strings.TrimSpace(arr[0]), 10, 64); err == nil && v > 0 {
					return v
				}
			}
		}
	}
	return 0
}

func readBody(body io.ReadCloser, max int64) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	defer body.Close()
	if max <= 0 {
		max = 100 * 1024 * 1024
	}
	limited := io.LimitReader(body, max+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("request body exceeds %d bytes", max)
	}
	return data, nil
}
