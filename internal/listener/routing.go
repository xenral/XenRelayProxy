package listener

import (
	"net"
	"strings"

	"xenrelayproxy/internal/config"
)

type Router struct {
	cfg config.Config
}

func NewRouter(cfg config.Config) Router {
	return Router{cfg: cfg}
}

func (r Router) IsBlocked(host string) bool {
	host = normalizeHost(host)
	return matchesAny(host, r.cfg.BlockHosts)
}

func (r Router) ShouldBypass(host string) bool {
	host = normalizeHost(host)
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
	}
	return matchesAny(host, r.cfg.BypassHosts) || matchesAny(host, r.cfg.DirectTunnelHosts)
}

func (r Router) ShouldDirectGoogle(host string) bool {
	host = normalizeHost(host)
	if matchesAny(host, r.cfg.DirectGoogleExclude) {
		return false
	}
	return matchesAny(host, r.cfg.DirectGoogleAllow)
}

func (r Router) ShouldSNIRewrite(host string) bool {
	host = normalizeHost(host)
	if r.ShouldDirectGoogle(host) || r.ShouldBypass(host) {
		return false
	}
	return matchesAny(host, r.cfg.SNIRewriteHosts) || matchesAny(host, r.cfg.CookieCriticalHosts)
}

func (r Router) HostOverride(host string) string {
	host = normalizeHost(host)
	if r.cfg.Hosts == nil {
		return ""
	}
	return r.cfg.Hosts[host]
}

func matchesAny(host string, rules []string) bool {
	for _, rule := range rules {
		rule = normalizeHost(rule)
		if rule == "" {
			continue
		}
		if strings.HasPrefix(rule, ".") {
			if strings.HasSuffix(host, rule) || host == strings.TrimPrefix(rule, ".") {
				return true
			}
			continue
		}
		if host == rule || strings.HasSuffix(host, "."+rule) {
			return true
		}
	}
	return false
}

func normalizeHost(host string) string {
	host = strings.TrimSpace(strings.ToLower(host))
	host = strings.Trim(host, "[]")
	host = strings.TrimSuffix(host, ".")
	if strings.Contains(host, ":") {
		if h, _, err := net.SplitHostPort(host); err == nil {
			return strings.Trim(strings.TrimSuffix(strings.ToLower(h), "."), "[]")
		}
	}
	return host
}
