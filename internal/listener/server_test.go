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
