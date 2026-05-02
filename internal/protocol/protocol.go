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

type Reply struct {
	S int               `json:"s,omitempty"`
	H map[string]string `json:"h,omitempty"`
	B string            `json:"b,omitempty"`
	E string            `json:"e,omitempty"`
	R []Reply           `json:"r,omitempty"`
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
		out[canon] = strings.Join(values, ", ")
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
		return reply, RelayError(reply.E)
	}
	if reply.S == 0 {
		return Reply{}, fmt.Errorf("relay reply missing status")
	}
	return reply, nil
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
	for key, value := range reply.H {
		if key == "" {
			continue
		}
		header.Set(textproto.CanonicalMIMEHeaderKey(key), fmt.Sprint(value))
	}
	header.Del("Content-Length")
	header.Del("Transfer-Encoding")
	header.Set("Content-Length", strconv.Itoa(len(body)))
	return &http.Response{
		StatusCode:    status,
		Status:        fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       req,
	}, nil
}

type RelayError string

func (e RelayError) Error() string { return string(e) }

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
