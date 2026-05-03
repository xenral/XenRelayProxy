package obs

import (
	"errors"
	"strconv"
	"testing"
	"time"
)

func TestMetricsRecordsRequest(t *testing.T) {
	m := NewMetrics()
	m.Record("example.com", 100, 200, 50*time.Millisecond, nil)
	snap := m.Snapshot()
	if snap.TotalRequests != 1 {
		t.Fatalf("total = %d", snap.TotalRequests)
	}
	if snap.BytesUp != 100 || snap.BytesDown != 200 {
		t.Fatalf("bytes: up=%d down=%d", snap.BytesUp, snap.BytesDown)
	}
	if len(snap.Hosts) != 1 || snap.Hosts[0].Host != "example.com" {
		t.Fatalf("hosts: %#v", snap.Hosts)
	}
	if snap.Hosts[0].AvgLatencyMS < 49 || snap.Hosts[0].AvgLatencyMS > 60 {
		t.Fatalf("avg latency = %v", snap.Hosts[0].AvgLatencyMS)
	}
}

func TestMetricsCountsErrors(t *testing.T) {
	m := NewMetrics()
	m.Record("example.com", 0, 0, time.Millisecond, errors.New("boom"))
	snap := m.Snapshot()
	if snap.TotalErrors != 1 || snap.Hosts[0].Errors != 1 {
		t.Fatalf("error count missing: %#v", snap)
	}
}

func TestMetricsHostMapBounded(t *testing.T) {
	m := NewMetricsWithCap(4)
	for i := 0; i < 100; i++ {
		host := "host" + strconv.Itoa(i)
		m.Record(host, 0, 0, time.Millisecond, nil)
	}
	snap := m.Snapshot()
	if len(snap.Hosts) > 4 {
		t.Fatalf("host map exceeded cap: %d", len(snap.Hosts))
	}
	if snap.TotalRequests != 100 {
		t.Fatalf("total counter should still be exact: %d", snap.TotalRequests)
	}
}

func TestMetricsLRUKeepsRecentHosts(t *testing.T) {
	m := NewMetricsWithCap(2)
	m.Record("a", 0, 0, time.Millisecond, nil)
	m.Record("b", 0, 0, time.Millisecond, nil)
	m.Record("a", 0, 0, time.Millisecond, nil) // a is now most recent
	m.Record("c", 0, 0, time.Millisecond, nil) // should evict b, keep a + c

	snap := m.Snapshot()
	hosts := map[string]bool{}
	for _, h := range snap.Hosts {
		hosts[h.Host] = true
	}
	if !hosts["a"] || !hosts["c"] {
		t.Fatalf("expected a and c to survive, got %v", hosts)
	}
	if hosts["b"] {
		t.Fatal("b should have been evicted")
	}
}

func TestSetCapEvictsToFit(t *testing.T) {
	m := NewMetricsWithCap(10)
	for i := 0; i < 5; i++ {
		m.Record("host"+strconv.Itoa(i), 0, 0, time.Millisecond, nil)
	}
	m.SetCap(2)
	snap := m.Snapshot()
	if len(snap.Hosts) != 2 {
		t.Fatalf("expected 2 hosts after SetCap(2), got %d", len(snap.Hosts))
	}
}

func TestRingBufferAddAndTail(t *testing.T) {
	r := NewRing(3)
	r.Add(LevelInfo, "src", "first")
	r.Add(LevelWarn, "src", "second")
	r.Add(LevelError, "src", "third")
	r.Add(LevelInfo, "src", "fourth")

	tail := r.Tail(0)
	if len(tail) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(tail))
	}
	if tail[0].Message != "second" || tail[2].Message != "fourth" {
		t.Fatalf("oldest entry not evicted: %#v", tail)
	}
}

func TestRingTailLimit(t *testing.T) {
	r := NewRing(10)
	for i := 0; i < 5; i++ {
		r.Add(LevelInfo, "src", strconv.Itoa(i))
	}
	tail := r.Tail(2)
	if len(tail) != 2 {
		t.Fatalf("expected 2 entries with limit, got %d", len(tail))
	}
	if tail[0].Message != "3" || tail[1].Message != "4" {
		t.Fatalf("wrong tail entries: %#v", tail)
	}
}

func TestRingSubscribeReceivesEntries(t *testing.T) {
	r := NewRing(5)
	got := []Entry{}
	r.Subscribe(func(e Entry) { got = append(got, e) })
	r.Add(LevelInfo, "src", "hello")
	if len(got) != 1 || got[0].Message != "hello" {
		t.Fatalf("subscriber missed entry: %#v", got)
	}
}
