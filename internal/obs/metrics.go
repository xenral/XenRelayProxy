package obs

import (
	"sync"
	"time"
)

type Metrics struct {
	mu             sync.Mutex
	startedAt      time.Time
	totalRequests  int64
	totalErrors    int64
	bytesUp        int64
	bytesDown      int64
	lastLatencyMS  float64
	hostRequests   map[string]int64
	hostErrors     map[string]int64
	hostLatencySum map[string]float64
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
	return &Metrics{
		startedAt:      time.Now(),
		hostRequests:   map[string]int64{},
		hostErrors:     map[string]int64{},
		hostLatencySum: map[string]float64{},
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
	if host != "" {
		m.hostRequests[host]++
		m.hostLatencySum[host] += ms
	}
	if err != nil {
		m.totalErrors++
		if host != "" {
			m.hostErrors[host]++
		}
	}
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
