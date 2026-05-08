package listener

import (
	"context"
	"errors"
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
	"xenrelayproxy/internal/protocol"
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

	// Probe the URL — chasing redirects ourselves up to maxHops so the chunked
	// path can run end-to-end on the resolved URL instead of bouncing the
	// browser through a redirect that may land on a non-chunkable handler.
	const maxHops = 5
	currentURL := req.URL
	var probeResp *http.Response
	// tooLargeSize is set when the relay reported the upstream response was
	// too big for its per-call cap. In that case we don't have a probe body,
	// but we do know the total file size and can chunk by Range from scratch.
	var tooLargeSize int64
	var probeHeader http.Header
	for hop := 0; hop <= maxHops; hop++ {
		probeReq := cloneRangeRequestForURL(req, currentURL, 0, chunkSize-1)
		resp, err := s.relay.Do(req.Context(), probeReq)
		if err != nil {
			var tle *protocol.TooLargeError
			if errors.As(err, &tle) && tle.Size > 0 {
				s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("probe %s: relay reported too_large (%d bytes) — switching to chunked retry", currentURL.String(), tle.Size))
				tooLargeSize = tle.Size
				probeHeader = tle.Headers
				break
			}
			s.logs.Add(obs.LevelError, "download", "probe failed for "+currentURL.String()+": "+err.Error())
			return false, nil // let normal relay handle it
		}
		if isRedirect(resp.StatusCode) {
			loc := resp.Header.Get("Location")
			_ = resp.Body.Close()
			if loc == "" {
				s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe %s: %d without Location, falling back", currentURL.String(), resp.StatusCode))
				return false, nil
			}
			next, err := currentURL.Parse(loc)
			if err != nil {
				s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe %s: bad Location %q: %s", currentURL.String(), loc, err.Error()))
				return false, nil
			}
			s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("probe %d redirect → %s", resp.StatusCode, next.String()))
			currentURL = next
			if hop == maxHops {
				s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe redirect limit (%d) exceeded, falling back", maxHops))
				return false, nil
			}
			continue
		}
		probeResp = resp
		break
	}

	if tooLargeSize == 0 && probeResp == nil {
		return false, nil
	}

	// Branch for the too_large path: synthesize the values that the normal
	// 206 path would have produced and skip the probe-body-as-first-chunk
	// optimization. firstChunkBody is left empty, so the chunk loop fetches
	// the full file via Range requests starting at offset 0.
	var firstChunkBody []byte
	var total int64
	var responseHeader http.Header
	if tooLargeSize > 0 {
		total = tooLargeSize
		responseHeader = probeHeader
		if responseHeader == nil {
			responseHeader = http.Header{}
		}
	} else {
		defer probeResp.Body.Close()
		// If probe got a 200 instead of 206, check if the response looks like
		// a download and try to return it directly (server doesn't support Range).
		if probeResp.StatusCode != http.StatusPartialContent {
			if probeResp.StatusCode == http.StatusOK && isDownloadResponse(probeResp.Header) {
				s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("probe %s: got 200 with download headers, streaming single response", currentURL.String()))
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
			s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe %s: server returned %d (not 206), falling back to normal relay", currentURL.String(), probeResp.StatusCode))
			return false, nil
		}
		var perr error
		total, perr = parseTotalFromContentRange(probeResp.Header.Get("Content-Range"))
		if perr != nil || total <= 0 {
			s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("probe %s: could not parse Content-Range %q, falling back", req.URL.String(), probeResp.Header.Get("Content-Range")))
			return false, nil
		}
		responseHeader = probeResp.Header
	}
	if total < s.cfg.DownloadMinSize {
		s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("file %d bytes < min %d, skipping chunked for %s", total, s.cfg.DownloadMinSize, filename))
		return false, nil
	}
	if total > s.cfg.MaxResponseBodyBytes {
		s.logs.Add(obs.LevelWarn, "download", fmt.Sprintf("file too large [chunked-cap]: %d bytes > max_response_body_bytes %d — raise this in Settings → Downloads", total, s.cfg.MaxResponseBodyBytes))
		return true, fmt.Errorf("file too large: %d bytes (cap %d, configured by max_response_body_bytes)", total, s.cfg.MaxResponseBodyBytes)
	}
	// If we have probe body bytes (regular 206 path), the first chunk reuses
	// what the probe already fetched. In the too_large path we have nothing,
	// so the chunk loop fetches every byte from offset 0. firstChunkSize == 0
	// is the signal for that mode.
	if tooLargeSize == 0 {
		var rerr error
		firstChunkBody, rerr = io.ReadAll(probeResp.Body)
		if rerr != nil {
			s.logs.Add(obs.LevelWarn, "download", "failed reading probe body: "+rerr.Error())
			return true, rerr
		}
	}
	firstChunkSize := int64(len(firstChunkBody))

	// Auto-scale chunk size if the remaining-byte fetch would otherwise
	// exceed the configured chunk-count cap. The cap is a sizing knob, not
	// a hard file-size ceiling.
	chunks := computeChunks(total, firstChunkSize, chunkSize)
	if s.cfg.DownloadMaxChunks > 0 && chunks > s.cfg.DownloadMaxChunks {
		remainingCap := int64(s.cfg.DownloadMaxChunks)
		if firstChunkSize > 0 {
			remainingCap = int64(s.cfg.DownloadMaxChunks - 1)
			if remainingCap < 1 {
				remainingCap = 1
			}
		}
		remainingBytes := total - firstChunkSize
		newChunkSize := (remainingBytes + remainingCap - 1) / remainingCap
		if newChunkSize < int64(chunkSize) {
			newChunkSize = int64(chunkSize)
		}
		s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("auto-scaling chunk size %d → %d to keep chunks ≤ %d (file %d bytes)", chunkSize, newChunkSize, s.cfg.DownloadMaxChunks, total))
		chunkSize = newChunkSize
		chunks = computeChunks(total, firstChunkSize, chunkSize)
	}

	// Register download for progress tracking. Wire a cancellable context
	// so the user (UI cancel button) or a browser disconnect can abort the
	// in-flight chunk fetches without leaving the proxy downloading bytes
	// the client no longer wants.
	dlID := s.downloads.NextID()
	s.downloads.Start(dlID, req.URL.String(), filename, total, chunks)
	dlCtx, dlCancel := context.WithCancel(req.Context())
	defer dlCancel()
	s.downloads.SetCancel(dlID, dlCancel)
	mode := "streaming"
	if tooLargeSize > 0 {
		mode = "streaming (too_large retry)"
	}
	s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("%s %s: %s (%s, %d chunks)",
		mode, dlID, filename, fmtBytesGo(total), chunks))

	// Send HTTP headers to browser immediately.
	header := responseHeader.Clone()
	if header == nil {
		header = http.Header{}
	}
	header.Set("Accept-Ranges", "bytes")
	// In the too_large path we don't have the upstream's content-type from
	// the probe body. The relay's reply headers usually include it; if not,
	// the browser will sniff.
	if err := sw.WriteHeaders(http.StatusOK, header, total); err != nil {
		s.downloads.Fail(dlID, err.Error())
		s.cleanupDownload(dlID)
		return true, err
	}

	if firstChunkSize > 0 {
		if err := sw.WriteBody(firstChunkBody); err != nil {
			s.downloads.Fail(dlID, err.Error())
			s.cleanupDownload(dlID)
			return true, err
		}
		_ = sw.Flush()
		s.downloads.AddBytes(dlID, firstChunkSize)
		s.downloads.ChunkDone(dlID)

		if chunks <= 1 {
			s.downloads.Finish(dlID)
			s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("%s complete (single chunk): %s", dlID, filename))
			s.cleanupDownload(dlID)
			return true, nil
		}
	}

	// Prepare ordered chunk channels for streaming in order. When the probe
	// body was reused as chunk 0 (firstChunkSize > 0), the parallel loop
	// fetches the remaining chunks. Otherwise it fetches every chunk.
	remaining := chunks
	if firstChunkSize > 0 {
		remaining = chunks - 1
	}
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
		chunkIdx := i
		if firstChunkSize > 0 {
			chunkIdx = i + 1
		}
		start := firstChunkSize + int64(i)*chunkSize
		end := start + chunkSize - 1
		if end >= total {
			end = total - 1
		}
		wg.Add(1)
		go func(idx int, start, end int64, ch chan<- chunkResult) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-dlCtx.Done():
				ch <- chunkResult{err: dlCtx.Err()}
				return
			}
			defer func() { <-sem }()
			if dlCtx.Err() != nil {
				ch <- chunkResult{err: dlCtx.Err()}
				return
			}
			partReq := cloneRangeRequestForURL(req, currentURL, start, end)
			partResp, err := s.relay.Do(dlCtx, partReq)
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

	// Stream chunks to the browser in order as they become ready. Any write
	// error or upstream chunk error cancels the shared dlCtx so in-flight
	// goroutines abort instead of continuing to fetch bytes the client no
	// longer wants.
	var streamErr error
	for i := 0; i < remaining; i++ {
		res := <-ready[i]
		if res.err != nil {
			streamErr = res.err
			dlCancel()
			break
		}
		if err := sw.WriteBody(res.data); err != nil {
			streamErr = fmt.Errorf("write to client: %w", err)
			dlCancel()
			break
		}
		_ = sw.Flush()
		s.downloads.AddBytes(dlID, int64(len(res.data)))
		s.downloads.ChunkDone(dlID)
	}

	// Wait for all goroutines to finish (even if we broke early).
	wg.Wait()

	if streamErr != nil {
		// User-driven cancellation (UI or browser disconnect) shows up as a
		// context.Canceled inside streamErr — surface it as a "cancelled"
		// status, not a failure.
		if errors.Is(streamErr, context.Canceled) || isBrowserDisconnect(streamErr) {
			s.logs.Add(obs.LevelInfo, "download", fmt.Sprintf("%s cancelled: %s", dlID, filename))
			// Cancel() may have already set status; if not (e.g. write error
			// triggered cancel), set it now.
			s.downloads.Cancel(dlID)
			s.cleanupDownload(dlID)
			return true, streamErr
		}
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
	return cloneRangeRequestForURL(req, req.URL, start, end)
}

// cloneRangeRequestForURL returns a clone of req with its URL retargeted
// (used when chasing redirects during the chunked-download probe) and a
// Range header set for [start, end].
func cloneRangeRequestForURL(req *http.Request, u *url.URL, start, end int64) *http.Request {
	clone := req.Clone(req.Context())
	clone.URL = u
	if u != nil {
		clone.Host = u.Host
	}
	clone.Body = nil
	clone.ContentLength = 0
	clone.Header = req.Header.Clone()
	clone.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	clone.RequestURI = ""
	return clone
}

// isBrowserDisconnect reports whether err looks like a normal client-side
// connection close (broken pipe, reset, EOF on write). These are expected
// when the user cancels the download in the browser and should be treated
// as cancellations, not internal failures.
func isBrowserDisconnect(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.ErrClosedPipe) || errors.Is(err, io.EOF) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "connection reset by peer") ||
		strings.Contains(msg, "use of closed network connection") ||
		strings.Contains(msg, "client disconnected") ||
		strings.Contains(msg, "context canceled")
}

// computeChunks returns the number of chunks needed to cover total bytes
// when the first firstChunkBytes are already in hand and remaining bytes
// are split into chunkSize-sized pieces.
func computeChunks(total, firstChunkBytes, chunkSize int64) int {
	if chunkSize <= 0 || total <= 0 {
		return 0
	}
	if firstChunkBytes >= total {
		return 1
	}
	remaining := total - firstChunkBytes
	rest := int((remaining + chunkSize - 1) / chunkSize)
	if firstChunkBytes > 0 {
		return 1 + rest
	}
	return rest
}

// isRedirect reports whether status is one of the HTTP redirect codes that
// carry a Location header we can follow with a GET-equivalent request.
func isRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently,    // 301
		http.StatusFound,                 // 302
		http.StatusSeeOther,              // 303
		http.StatusTemporaryRedirect,     // 307
		http.StatusPermanentRedirect:     // 308
		return true
	}
	return false
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
