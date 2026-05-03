package obs

import (
	"sync"
	"time"
)

// DefaultMaxHosts caps the number of distinct hosts tracked in per-host
// counters. The cap prevents unbounded memory growth under high-cardinality
// traffic (e.g. tracker domains, ad networks, randomized CDN hostnames).
const DefaultMaxHosts = 256

type Metrics struct {
	mu             sync.Mutex
	startedAt      time.Time
	totalRequests  int64
	totalErrors    int64
	bytesUp        int64
	bytesDown      int64
	lastLatencyMS  float64
	maxHosts       int
	hostRequests   map[string]int64
	hostErrors     map[string]int64
	hostLatencySum map[string]float64
	hostLastSeen   map[string]int64
	tick           int64
}

type Snapshot struct {
	StartedAt     string         `json:"started_at"`
	TotalRequests int64          `json:"total_requests"`
	TotalErrors   int64          `json:"total_errors"`
	BytesUp       int64          `json:"bytes_up"`
	BytesDown     int64          `json:"bytes_down"`
	LastLatencyMS float64        `json:"last_latency_ms"`
	Hosts         []HostSnapshot `json:"hosts"`
}

type HostSnapshot struct {
	Host         string  `json:"host"`
	Requests     int64   `json:"requests"`
	Errors       int64   `json:"errors"`
	AvgLatencyMS float64 `json:"avg_latency_ms"`
}

func NewMetrics() *Metrics {
	return NewMetricsWithCap(DefaultMaxHosts)
}

func NewMetricsWithCap(maxHosts int) *Metrics {
	if maxHosts <= 0 {
		maxHosts = DefaultMaxHosts
	}
	return &Metrics{
		startedAt:      time.Now(),
		maxHosts:       maxHosts,
		hostRequests:   map[string]int64{},
		hostErrors:     map[string]int64{},
		hostLatencySum: map[string]float64{},
		hostLastSeen:   map[string]int64{},
	}
}

// SetCap updates the max-hosts cap. If lowered below the current set size,
// least-recently-seen hosts are evicted to fit.
func (m *Metrics) SetCap(maxHosts int) {
	if maxHosts <= 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.maxHosts = maxHosts
	for len(m.hostRequests) > m.maxHosts {
		m.evictLRULocked()
	}
}

func (m *Metrics) Record(host string, up, down int64, latency time.Duration, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.totalRequests++
	m.bytesUp += up
	m.bytesDown += down
	ms := float64(latency.Microseconds()) / 1000
	m.lastLatencyMS = ms
	if err != nil {
		m.totalErrors++
	}
	if host == "" {
		return
	}
	m.tick++
	if _, known := m.hostRequests[host]; !known && len(m.hostRequests) >= m.maxHosts {
		m.evictLRULocked()
	}
	m.hostRequests[host]++
	m.hostLatencySum[host] += ms
	m.hostLastSeen[host] = m.tick
	if err != nil {
		m.hostErrors[host]++
	}
}

func (m *Metrics) evictLRULocked() {
	var oldestHost string
	var oldestSeen int64
	first := true
	for host, seen := range m.hostLastSeen {
		if first || seen < oldestSeen {
			oldestHost = host
			oldestSeen = seen
			first = false
		}
	}
	if oldestHost == "" {
		return
	}
	delete(m.hostRequests, oldestHost)
	delete(m.hostErrors, oldestHost)
	delete(m.hostLatencySum, oldestHost)
	delete(m.hostLastSeen, oldestHost)
}

func (m *Metrics) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	snap := Snapshot{
		StartedAt:     m.startedAt.Format(time.RFC3339),
		TotalRequests: m.totalRequests,
		TotalErrors:   m.totalErrors,
		BytesUp:       m.bytesUp,
		BytesDown:     m.bytesDown,
		LastLatencyMS: m.lastLatencyMS,
	}
	for host, count := range m.hostRequests {
		avg := 0.0
		if count > 0 {
			avg = m.hostLatencySum[host] / float64(count)
		}
		snap.Hosts = append(snap.Hosts, HostSnapshot{
			Host:         host,
			Requests:     count,
			Errors:       m.hostErrors[host],
			AvgLatencyMS: avg,
		})
	}
	return snap
}
