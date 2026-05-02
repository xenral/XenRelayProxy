package frontscan

import (
	"context"
	"crypto/tls"
	"net"
	"sort"
	"sync"
	"time"
)

type Result struct {
	IP        string  `json:"ip"`
	RTTMS     float64 `json:"rtt_ms"`
	OK        bool    `json:"ok"`
	Error     string  `json:"error,omitempty"`
	Recommend bool    `json:"recommend"`
}

var CandidateIPs = []string{
	"216.239.32.120",
	"216.239.34.120",
	"216.239.36.120",
	"216.239.38.120",
	"142.250.80.142",
	"142.250.80.138",
	"142.250.179.110",
	"142.250.185.110",
	"142.250.184.206",
	"142.250.190.238",
	"142.250.191.78",
	"172.217.1.206",
	"172.217.14.206",
	"172.217.16.142",
	"172.217.22.174",
	"172.217.164.110",
	"172.217.168.206",
	"172.217.169.206",
	"34.107.221.82",
	"142.251.32.110",
	"142.251.33.110",
	"142.251.46.206",
	"142.251.46.238",
	"142.250.80.170",
	"142.250.72.206",
	"142.250.64.206",
	"142.250.72.110",
}

func Scan(ctx context.Context, frontDomain string, ips []string) ([]Result, error) {
	if len(ips) == 0 {
		ips = CandidateIPs
	}
	if frontDomain == "" {
		frontDomain = "www.google.com"
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	jobs := make(chan string)
	results := make(chan Result, len(ips))
	var wg sync.WaitGroup
	workers := 8
	if len(ips) < workers {
		workers = len(ips)
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range jobs {
				results <- probe(ctx, frontDomain, ip)
			}
		}()
	}
	for _, ip := range ips {
		select {
		case jobs <- ip:
		case <-ctx.Done():
			break
		}
	}
	close(jobs)
	wg.Wait()
	close(results)

	out := make([]Result, 0, len(ips))
	for r := range results {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].OK != out[j].OK {
			return out[i].OK
		}
		return out[i].RTTMS < out[j].RTTMS
	})
	for i := range out {
		if out[i].OK {
			out[i].Recommend = true
			break
		}
	}
	return out, nil
}

func probe(ctx context.Context, frontDomain, ip string) Result {
	start := time.Now()
	dialer := &net.Dialer{Timeout: 4 * time.Second, KeepAlive: 30 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", net.JoinHostPort(ip, "443"), &tls.Config{
		ServerName: frontDomain,
		MinVersion: tls.VersionTLS12,
		NextProtos: []string{"h2", "http/1.1"},
	})
	if err != nil {
		return Result{IP: ip, OK: false, Error: err.Error()}
	}
	done := make(chan struct{})
	go func() {
		_ = conn.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
	return Result{IP: ip, OK: true, RTTMS: float64(time.Since(start).Microseconds()) / 1000}
}
