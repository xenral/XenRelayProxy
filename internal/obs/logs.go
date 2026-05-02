package obs

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type Level string

const (
	LevelDebug Level = "DEBUG"
	LevelInfo  Level = "INFO"
	LevelWarn  Level = "WARNING"
	LevelError Level = "ERROR"
)

type Entry struct {
	Time    string `json:"time"`
	Level   Level  `json:"level"`
	Message string `json:"message"`
	Source  string `json:"source,omitempty"`
}

type Ring struct {
	mu      sync.Mutex
	entries []Entry
	next    int
	full    bool
	sinks   []func(Entry)
}

func NewRing(size int) *Ring {
	if size <= 0 {
		size = 500
	}
	return &Ring{entries: make([]Entry, size)}
}

func (r *Ring) Add(level Level, source, msg string) {
	entry := Entry{Time: time.Now().Format(time.RFC3339), Level: level, Source: source, Message: msg}
	r.mu.Lock()
	r.entries[r.next] = entry
	r.next = (r.next + 1) % len(r.entries)
	if r.next == 0 {
		r.full = true
	}
	sinks := append([]func(Entry){}, r.sinks...)
	r.mu.Unlock()
	for _, sink := range sinks {
		sink(entry)
	}
}

func (r *Ring) Tail(limit int) []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Entry
	if r.full {
		out = append(out, r.entries[r.next:]...)
	}
	out = append(out, r.entries[:r.next]...)
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return append([]Entry(nil), out...)
}

func (r *Ring) Subscribe(sink func(Entry)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sinks = append(r.sinks, sink)
}

type Handler struct {
	ring *Ring
}

func NewHandler(ring *Ring) *Handler {
	return &Handler{ring: ring}
}

func (h *Handler) Enabled(_ context.Context, level slog.Level) bool {
	return true
}

func (h *Handler) Handle(_ context.Context, record slog.Record) error {
	level := LevelInfo
	switch {
	case record.Level <= slog.LevelDebug:
		level = LevelDebug
	case record.Level >= slog.LevelError:
		level = LevelError
	case record.Level >= slog.LevelWarn:
		level = LevelWarn
	}
	source := ""
	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key == "source" {
			source = attr.Value.String()
		}
		return true
	})
	h.ring.Add(level, source, record.Message)
	return nil
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler { return h }
func (h *Handler) WithGroup(name string) slog.Handler       { return h }
