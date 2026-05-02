package listener

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

func (s *Server) tryChunkedDownload(req *http.Request) (*http.Response, bool, error) {
	if req.Method != http.MethodGet || req.Body != nil && req.ContentLength > 0 {
		return nil, false, nil
	}
	if req.Header.Get("Range") != "" || !s.isLikelyDownload(req.URL) {
		return nil, false, nil
	}
	chunkSize := s.cfg.DownloadChunkSize
	if chunkSize <= 0 {
		chunkSize = 512 * 1024
	}
	probeReq := cloneRangeRequest(req, 0, chunkSize-1)
	probeResp, err := s.relay.Do(req.Context(), probeReq)
	if err != nil {
		return nil, true, err
	}
	defer probeResp.Body.Close()
	if probeResp.StatusCode != http.StatusPartialContent {
		return nil, false, nil
	}
	total, err := parseTotalFromContentRange(probeResp.Header.Get("Content-Range"))
	if err != nil || total <= 0 {
		return nil, false, nil
	}
	if total < s.cfg.DownloadMinSize {
		return nil, false, nil
	}
	if total > s.cfg.MaxResponseBodyBytes {
		return nil, true, fmt.Errorf("file too large for configured response cap: %d bytes", total)
	}
	chunks := int((total + chunkSize - 1) / chunkSize)
	if s.cfg.DownloadMaxChunks > 0 && chunks > s.cfg.DownloadMaxChunks {
		return nil, true, fmt.Errorf("file requires %d chunks, max is %d", chunks, s.cfg.DownloadMaxChunks)
	}

	body := make([]byte, total)
	first, err := io.ReadAll(probeResp.Body)
	if err != nil {
		return nil, true, err
	}
	copy(body, first)

	parallel := s.cfg.DownloadMaxParallel
	if parallel <= 0 {
		parallel = 4
	}
	sem := make(chan struct{}, parallel)
	errCh := make(chan error, chunks)
	var wg sync.WaitGroup
	for i := 1; i < chunks; i++ {
		start := int64(i) * chunkSize
		end := start + chunkSize - 1
		if end >= total {
			end = total - 1
		}
		wg.Add(1)
		go func(start, end int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			partReq := cloneRangeRequest(req, start, end)
			partResp, err := s.relay.Do(req.Context(), partReq)
			if err != nil {
				errCh <- err
				return
			}
			defer partResp.Body.Close()
			if partResp.StatusCode != http.StatusPartialContent && partResp.StatusCode != http.StatusOK {
				errCh <- fmt.Errorf("range %d-%d returned status %d", start, end, partResp.StatusCode)
				return
			}
			part, err := io.ReadAll(partResp.Body)
			if err != nil {
				errCh <- err
				return
			}
			copy(body[start:], part)
		}(start, end)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			return nil, true, err
		}
	}

	header := probeResp.Header.Clone()
	header.Del("Content-Range")
	header.Del("Transfer-Encoding")
	header.Set("Content-Length", strconv.FormatInt(total, 10))
	header.Set("Accept-Ranges", "bytes")
	return &http.Response{
		StatusCode:    http.StatusOK,
		Status:        "200 OK",
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: total,
		Request:       req,
	}, true, nil
}

func (s *Server) isLikelyDownload(u *url.URL) bool {
	if u == nil {
		return false
	}
	path := strings.ToLower(u.Path)
	for _, ext := range s.cfg.DownloadExtensions {
		if strings.HasSuffix(path, strings.ToLower(ext)) {
			return true
		}
	}
	return false
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
