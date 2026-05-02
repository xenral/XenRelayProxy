package cache

import (
	"bytes"
	"container/list"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Cache struct {
	mu       sync.Mutex
	maxBytes int64
	used     int64
	ll       *list.List
	items    map[string]*list.Element
}

type entry struct {
	key       string
	status    int
	header    http.Header
	body      []byte
	size      int64
	expiresAt time.Time
}

func New(maxBytes int64) *Cache {
	if maxBytes <= 0 {
		maxBytes = 50 * 1024 * 1024
	}
	return &Cache{maxBytes: maxBytes, ll: list.New(), items: map[string]*list.Element{}}
}

func (c *Cache) Get(key string) (*http.Response, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el := c.items[key]
	if el == nil {
		return nil, false
	}
	ent := el.Value.(*entry)
	if time.Now().After(ent.expiresAt) {
		c.removeElement(el)
		return nil, false
	}
	c.ll.MoveToFront(el)
	return responseFromEntry(ent), true
}

func (c *Cache) Put(key string, resp *http.Response, body []byte, ttl time.Duration) {
	if ttl <= 0 || resp == nil || resp.StatusCode != http.StatusOK || len(body) == 0 {
		return
	}
	size := int64(len(body))
	if size > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if old := c.items[key]; old != nil {
		c.removeElement(old)
	}
	ent := &entry{
		key:       key,
		status:    resp.StatusCode,
		header:    resp.Header.Clone(),
		body:      append([]byte(nil), body...),
		size:      size,
		expiresAt: time.Now().Add(ttl),
	}
	el := c.ll.PushFront(ent)
	c.items[key] = el
	c.used += size
	for c.used > c.maxBytes && c.ll.Len() > 0 {
		c.removeElement(c.ll.Back())
	}
}

func (c *Cache) removeElement(el *list.Element) {
	if el == nil {
		return
	}
	c.ll.Remove(el)
	ent := el.Value.(*entry)
	delete(c.items, ent.key)
	c.used -= ent.size
}

func Cacheable(req *http.Request) bool {
	if req == nil || req.Method != http.MethodGet {
		return false
	}
	for _, name := range []string{"Cookie", "Authorization", "Proxy-Authorization", "Range", "Cache-Control", "Pragma"} {
		if req.Header.Get(name) != "" {
			return false
		}
	}
	return true
}

func TTL(resp *http.Response, rawURL string) time.Duration {
	if resp == nil || resp.StatusCode != http.StatusOK {
		return 0
	}
	cc := strings.ToLower(resp.Header.Get("Cache-Control"))
	if strings.Contains(cc, "no-store") || strings.Contains(cc, "no-cache") || strings.Contains(cc, "private") {
		return 0
	}
	for _, part := range strings.Split(cc, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "max-age=") {
			seconds, err := strconv.Atoi(strings.TrimPrefix(part, "max-age="))
			if err == nil && seconds > 0 {
				if seconds > 86400 {
					seconds = 86400
				}
				return time.Duration(seconds) * time.Second
			}
		}
	}
	u, err := url.Parse(rawURL)
	if err == nil {
		path := strings.ToLower(u.Path)
		for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf"} {
			if strings.HasSuffix(path, ext) {
				return time.Hour
			}
		}
		for _, ext := range []string{".css", ".js", ".mjs", ".wasm"} {
			if strings.HasSuffix(path, ext) {
				return 30 * time.Minute
			}
		}
	}
	return 0
}

func responseFromEntry(ent *entry) *http.Response {
	body := append([]byte(nil), ent.body...)
	resp := &http.Response{
		StatusCode:    ent.status,
		Status:        strconv.Itoa(ent.status) + " " + http.StatusText(ent.status),
		Header:        ent.header.Clone(),
		Body:          nopReadCloser{bytes.NewReader(body)},
		ContentLength: int64(len(body)),
	}
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	return resp
}

type nopReadCloser struct{ *bytes.Reader }

func (n nopReadCloser) Close() error { return nil }
