package listener

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"xenrelayproxy/internal/obs"
)

// streamWriter abstracts writing an HTTP response so the same download logic
// works for both raw MITM connections (net.Conn) and http.ResponseWriter.
type streamWriter interface {
	WriteHeaders(status int, header http.Header, contentLength int64) error
	WriteBody(p []byte) error
	Flush() error
}

// ── rawConnWriter writes raw HTTP/1.1 to a net.Conn (MITM path) ──────────

type rawConnWriter struct{ w io.Writer }

func (r *rawConnWriter) WriteHeaders(status int, header http.Header, contentLength int64) error {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("HTTP/1.1 %d %s\r\n", status, http.StatusText(status)))
	skip := map[string]bool{"content-range": true, "transfer-encoding": true, "content-length": true}
	for key, vals := range header {
		if skip[strings.ToLower(key)] {
			continue
		}
		for _, v := range vals {
			b.WriteString(key)
			b.WriteString(": ")
			b.WriteString(v)
			b.WriteString("\r\n")
		}
	}
	b.WriteString(fmt.Sprintf("Content-Length: %d\r\n", contentLength))
	b.WriteString("\r\n")
	_, err := io.WriteString(r.w, b.String())
	return err
}

func (r *rawConnWriter) WriteBody(p []byte) error {
	_, err := r.w.Write(p)
	return err
}

func (r *rawConnWriter) Flush() error { return nil }

// ── httpResponseWriterAdapter writes to an http.ResponseWriter ───────────

type httpResponseWriterAdapter struct {
	w       http.ResponseWriter
	written bool
}

func (h *httpResponseWriterAdapter) WriteHeaders(status int, header http.Header, contentLength int64) error {
	skip := map[string]bool{"content-range": true, "transfer-encoding": true, "content-length": true}
	for key, vals := range header {
		if skip[strings.ToLower(key)] {
			continue
		}
		for _, v := range vals {
			h.w.Header().Add(key, v)
		}
	}
	h.w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
	h.w.WriteHeader(status)
	h.written = true
	return nil
}

func (h *httpResponseWriterAdapter) WriteBody(p []byte) error {
	_, err := h.w.Write(p)
	return err
}

func (h *httpResponseWriterAdapter) Flush() error {
	if f, ok := h.w.(http.Flusher); ok {
		f.Flush()
	}
	return nil
}

// ── chunk result for ordered streaming ───────────────────────────────────

type chunkResult struct {
	data []byte
	err  error
}

// ── tryStreamDownload streams a chunked download to the writer ───────────

func (s *Server) tryStreamDownload(req *http.Request, sw streamWriter) (handled bool, err error) {
	if req.Method != http.MethodGet || req.Body != nil && req.ContentLength > 0 {
		return false, nil
	}
	if req.Header.Get("Range") != "" {
		return false, nil
	}
	urlMatch := s.isLikelyDownload(req.URL)
	if !urlMatch {
		return false, nil
	}
	chunkSize := s.cfg.DownloadChunkSize
	if chunkSize <= 0 {
		chunkSize = 512 * 1024
	}

	filename := filenameFromURL(req.URL)
	s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("probing %s (%s)", req.URL.String(), filename))

	probeReq := cloneRangeRequest(req, 0, chunkSize-1)
	probeResp, err := s.relay.Do(req.Context(), probeReq)
	if err != nil {
		s.logs.Add(obs.LevelError, "download", "probe failed for "+req.URL.String()+": "+err.Error())
		return false, nil // let normal relay handle it
	}
	defer probeResp.Body.Close()

	// If probe got a 200 instead of 206, check if the response looks like
	// a download and try to return it directly (server doesn't support Range).
	if probeResp.StatusCode != http.StatusPartialContent {
		if probeResp.StatusCode == http.StatusOK && isDownloadResponse(probeResp.Header) {
			s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("probe %s: got 200 with download headers, streaming single response", req.URL.String()))
			body, err := io.ReadAll(probeResp.Body)
			if err != nil {
				s.logs.Add(obs.LevelError, "download", "failed reading 200 body: "+err.Error())
				return true, err
			}
			if err := sw.WriteHeaders(http.StatusOK, probeResp.Header, int64(len(body))); err != nil {
				return true, err
			}
			if err := sw.WriteBody(body); err != nil {
				return true, err
			}
			return true, nil
		}
		s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe %s: server returned %d (not 206), falling back to normal relay", req.URL.String(), probeResp.StatusCode))
		return false, nil
	}
	total, err := parseTotalFromContentRange(probeResp.Header.Get("Content-Range"))
	if err != nil || total <= 0 {
		s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe %s: could not parse Content-Range %q, falling back", req.URL.String(), probeResp.Header.Get("Content-Range")))
		return false, nil
	}
	if total < s.cfg.DownloadMinSize {
		s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("file %d bytes < min %d, skipping chunked for %s", total, s.cfg.DownloadMinSize, filename))
		return false, nil
	}
	if total > s.cfg.MaxResponseBodyBytes {
		s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("file too large: %d bytes (cap %d)", total, s.cfg.MaxResponseBodyBytes))
		return true, fmt.Errorf("file too large: %d bytes", total)
	}
	chunks := int((total + chunkSize - 1) / chunkSize)
	if s.cfg.DownloadMaxChunks > 0 && chunks > s.cfg.DownloadMaxChunks {
		s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("too many chunks: %d (max %d)", chunks, s.cfg.DownloadMaxChunks))
		return true, fmt.Errorf("file requires %d chunks, max is %d", chunks, s.cfg.DownloadMaxChunks)
	}

	// Read first chunk body.
	first, err := io.ReadAll(probeResp.Body)
	if err != nil {
		s.logs.Add(obs.LevelWarn, "download", "failed reading probe body: "+err.Error())
		return true, err
	}

	// Register download for progress tracking.
	dlID := s.downloads.NextID()
	s.downloads.Start(dlID, req.URL.String(), filename, total, chunks)
	s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("streaming %s: %s (%s, %d chunks)",
		dlID, filename, fmtBytesGo(total), chunks))

	// Send HTTP headers + first chunk to browser immediately.
	header := probeResp.Header.Clone()
	header.Set("Accept-Ranges", "bytes")
	if err := sw.WriteHeaders(http.StatusOK, header, total); err != nil {
		s.downloads.Fail(dlID, err.Error())
		s.cleanupDownload(dlID)
		return true, err
	}
	if err := sw.WriteBody(first); err != nil {
		s.downloads.Fail(dlID, err.Error())
		s.cleanupDownload(dlID)
		return true, err
	}
	_ = sw.Flush()
	s.downloads.AddBytes(dlID, int64(len(first)))
	s.downloads.ChunkDone(dlID)

	if chunks <= 1 {
		s.downloads.Finish(dlID)
		s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("%s complete (single chunk): %s", dlID, filename))
		s.cleanupDownload(dlID)
		return true, nil
	}

	// Prepare ordered chunk channels for streaming in order.
	remaining := chunks - 1
	ready := make([]chan chunkResult, remaining)
	for i := range ready {
		ready[i] = make(chan chunkResult, 1)
	}

	// Fetch remaining chunks in parallel.
	parallel := s.cfg.DownloadMaxParallel
	if parallel <= 0 {
		parallel = 4
	}
	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup
	for i := 0; i < remaining; i++ {
		chunkIdx := i + 1
		start := int64(chunkIdx) * chunkSize
		end := start + chunkSize - 1
		if end >= total {
			end = total - 1
		}
		wg.Add(1)
		go func(idx int, start, end int64, ch chan<- chunkResult) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			partReq := cloneRangeRequest(req, start, end)
			partResp, err := s.relay.Do(req.Context(), partReq)
			if err != nil {
				ch <- chunkResult{err: fmt.Errorf("chunk %d/%d failed: %w", idx+1, chunks, err)}
				return
			}
			defer partResp.Body.Close()
			if partResp.StatusCode != http.StatusPartialContent && partResp.StatusCode != http.StatusOK {
				ch <- chunkResult{err: fmt.Errorf("chunk %d/%d: status %d", idx+1, chunks, partResp.StatusCode)}
				return
			}
			part, err := io.ReadAll(partResp.Body)
			if err != nil {
				ch <- chunkResult{err: fmt.Errorf("chunk %d/%d read: %w", idx+1, chunks, err)}
				return
			}
			ch <- chunkResult{data: part}
		}(chunkIdx, start, end, ready[i])
	}

	// Stream chunks to the browser in order as they become ready.
	var streamErr error
	for i := 0; i < remaining; i++ {
		res := <-ready[i]
		if res.err != nil {
			streamErr = res.err
			break
		}
		if err := sw.WriteBody(res.data); err != nil {
			streamErr = fmt.Errorf("write to client: %w", err)
			break
		}
		_ = sw.Flush()
		s.downloads.AddBytes(dlID, int64(len(res.data)))
		s.downloads.ChunkDone(dlID)
	}

	// Wait for all goroutines to finish (even if we broke early).
	wg.Wait()

	if streamErr != nil {
		s.downloads.Fail(dlID, streamErr.Error())
		s.logs.Add(obs.LevelError, "download", fmt.Sprintf("%s failed: %s", dlID, streamErr.Error()))
		s.cleanupDownload(dlID)
		return true, streamErr
	}

	s.downloads.Finish(dlID)
	s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("%s complete: %s (%s)", dlID, filename, fmtBytesGo(total)))
	s.cleanupDownload(dlID)
	return true, nil
}

func (s *Server) cleanupDownload(dlID string) {
	go func() {
		time.Sleep(5 * time.Second)
		s.downloads.Remove(dlID)
	}()
}

func (s *Server) isLikelyDownload(u *url.URL) bool {
	if u == nil {
		return false
	}
	p := strings.ToLower(u.Path)
	for _, ext := range s.cfg.DownloadExtensions {
		if strings.HasSuffix(p, strings.ToLower(ext)) {
			return true
		}
	}
	// Also check query params for common download indicators.
	q := strings.ToLower(u.RawQuery)
	if strings.Contains(q, "download") || strings.Contains(q, "dl=") ||
		strings.Contains(q, "export=download") {
		return true
	}
	return false
}

func isDownloadResponse(header http.Header) bool {
	cd := header.Get("Content-Disposition")
	if strings.Contains(strings.ToLower(cd), "attachment") {
		return true
	}
	ct := strings.ToLower(header.Get("Content-Type"))
	return strings.HasPrefix(ct, "application/octet-stream") ||
		strings.HasPrefix(ct, "application/zip") ||
		strings.HasPrefix(ct, "application/x-tar") ||
		strings.HasPrefix(ct, "application/x-gzip") ||
		strings.HasPrefix(ct, "application/x-bzip2") ||
		strings.HasPrefix(ct, "application/x-7z-compressed") ||
		strings.HasPrefix(ct, "application/x-rar-compressed") ||
		strings.HasPrefix(ct, "video/") ||
		strings.HasPrefix(ct, "audio/")
}

func cloneRangeRequest(req *http.Request, start, end int64) *http.Request {
	clone := req.Clone(req.Context())
	clone.Body = nil
	clone.ContentLength = 0
	clone.Header = req.Header.Clone()
	clone.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	clone.RequestURI = ""
	return clone
}

func parseTotalFromContentRange(value string) (int64, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	slash := strings.LastIndex(value, "/")
	if slash < 0 || slash == len(value)-1 {
		return 0, fmt.Errorf("bad content-range: %q", value)
	}
	return strconv.ParseInt(value[slash+1:], 10, 64)
}

func filenameFromURL(u *url.URL) string {
	if u == nil {
		return "unknown"
	}
	base := path.Base(u.Path)
	if base == "" || base == "." || base == "/" {
		return "unknown"
	}
	return base
}

func fmtBytesGo(v int64) string {
	switch {
	case v < 1024:
		return fmt.Sprintf("%d B", v)
	case v < 1024*1024:
		return fmt.Sprintf("%.1f KB", float64(v)/1024)
	case v < 1024*1024*1024:
		return fmt.Sprintf("%.1f MB", float64(v)/(1024*1024))
	default:
		return fmt.Sprintf("%.2f GB", float64(v)/(1024*1024*1024))
	}
}
