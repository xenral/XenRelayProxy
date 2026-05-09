# XenRelayProxy

[![GitHub](https://img.shields.io/badge/GitHub-XenRelayProxy-blue?logo=github)](https://github.com/xenral/XenRelayProxy)

A Go/Wails desktop rewrite of [MasterHttpRelayVPN](https://github.com/masterking32/MasterHttpRelayVPN). It runs a local HTTP/SOCKS5 proxy that hides your traffic behind trusted Google domains and relays HTTPS requests through a free Google Apps Script deployment. No VPS, no server — just a free Google account.

> **In one line:** your browser/CLI talks to a local proxy, the proxy makes the traffic look like normal Google traffic to the firewall, and a Google Apps Script you deploy fetches the real site for you.

---

## Highlights

- **Wails v2 desktop app** — React + TypeScript front-end, Go backend.
- **Headless CLI** (`xenrelayproxy-cli`) for servers and smoke tests.
- **HTTP proxy + SOCKS5 listener** on `127.0.0.1:8085` and `127.0.0.1:1080`.
- **CONNECT MITM** with a per-machine CA, install/uninstall from the UI.
- **Multi-account scheduler** — least-loaded, round-robin, or weighted-random across deployments, with cooloff, quota tracking, and live stats.
- **Direct / SNI-rewrite / relay router** — picks the fastest safe path per host (direct Google IPs for `www.google.com`, SNI-rewrite for YouTube/CDN traffic, full relay for arbitrary HTTPS).
- **Chunked parallel downloads** with cancel-in-flight from the UI.
- **Front-IP scanner** to find the fastest reachable Google fronting IP.
- **Long-poll/SSE blocker** so Apps Script doesn't waste a 6-min slot on a hanging socket.
- **Optional self-hosted relay** (`server_relay/relay.py`) when you want to bypass Apps Script's UrlFetchApp limits.

---

## Quick Start

### Prerequisites

- Go **1.22+**
- Node **18+** with `npm`
- Wails v2 CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

### Build / Run (desktop app)

```bash
git clone https://github.com/xenral/XenRelayProxy.git
cd XenRelayProxy
cd frontend && npm install && cd ..
wails dev          # hot-reload dev mode
# or
wails build        # produces a release binary under build/bin
```

On first launch the in-app **Setup Wizard** walks you through:

1. Creating a Google Apps Script deployment from the bundled `apps_script/Code.gs`.
2. Pasting the Deployment ID and a generated `auth_key`.
3. Installing the local MITM CA into your OS trust store.
4. Saving `config.json` to your per-user app data folder.

### Headless CLI

For servers, headless test runs, or just bench-marking the core without launching the UI:

```bash
go run ./cmd/xenrelayproxy-cli -config config.json
```

Flags:
```
-config string   Path to config file (default "config.json")
-ca-cert string  Path to CA certificate file (default "ca/ca.crt")
-ca-key  string  Path to CA key file (default "ca/ca.key")
```

---

## Manual Setup (without the wizard)

### 1. Deploy the relay (`apps_script/Code.gs`)

1. Open <https://script.google.com> and create a **new project**.
2. Replace the default code with the contents of [`apps_script/Code.gs`](apps_script/Code.gs).
3. Change `AUTH_KEY` to a strong secret you'll reuse in `config.json`.
4. **Deploy → New deployment → Web app**, set **Execute as: Me** and **Who has access: Anyone**.
5. Copy the Deployment ID.

### 2. Configure

Copy `config.example.json` to `config.json` and fill in your values:

```json
{
  "mode": "apps_script",
  "google_ip": "216.239.38.120",
  "front_domain": "www.google.com",
  "auth_key": "YOUR_STRONG_SECRET",
  "accounts": [
    {
      "label": "primary",
      "script_id": "AKfycb...",
      "account_type": "consumer",
      "enabled": true,
      "weight": 1.0,
      "daily_quota": 20000
    }
  ],
  "scheduler": {
    "strategy": "least_loaded",
    "cooloff_seconds": 900,
    "throttle_backoff_seconds": 60,
    "quota_safety_margin": 0.95,
    "state_file": "state/scheduler_state.json"
  }
}
```

The `auth_key` here **must match** `AUTH_KEY` inside `Code.gs`.

### 3. Set your browser proxy

| Setting | Value |
|---------|-------|
| Proxy host | `127.0.0.1` |
| HTTP port  | `8085` |
| SOCKS5 port (optional) | `1080` |

- **Firefox:** Settings → Network Settings → Manual proxy → `127.0.0.1` `8085`, tick "Also use this proxy for HTTPS".
- **Chrome / Edge / Safari:** they read the OS-level proxy. Set it in System Settings.
- **FoxyProxy / SwitchyOmega** are the easiest if you only want some sites to use it.

### 4. Trust the MITM CA

XenRelayProxy creates a per-machine CA at `~/.config/XenRelayProxy/ca/ca.crt` (Linux) / `~/Library/Application Support/XenRelayProxy/ca/ca.crt` (macOS) / `%AppData%\XenRelayProxy\ca\ca.crt` (Windows) on first run.

The desktop app installs it for you (a confirmation dialog will appear). To install it manually:

**macOS**
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain "$HOME/Library/Application Support/XenRelayProxy/ca/ca.crt"
```

**Linux (Ubuntu/Debian)**
```bash
sudo cp ~/.config/XenRelayProxy/ca/ca.crt /usr/local/share/ca-certificates/xenrelayproxy.crt
sudo update-ca-certificates
```

**Windows (PowerShell, admin)**
```powershell
Import-Certificate -FilePath "$env:AppData\XenRelayProxy\ca\ca.crt" `
  -CertStoreLocation Cert:\LocalMachine\Root
```

> Firefox keeps its own trust store — import `ca.crt` under Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import.

---

## Use the Proxy from the Terminal (CLI tools)

Most CLI tools (curl, git, npm, pip, claude, codex, gemini, …) read the standard `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment variables. **Set them in the same shell** where you run the tool, or persist them in your shell profile so every new terminal picks them up.

> Snippets below assume the proxy is running on `127.0.0.1:8085`. Restart already-running tools after exporting the variables — env changes don't propagate to live processes.

### Linux (bash / zsh)

```bash
# current shell only
export HTTP_PROXY="http://127.0.0.1:8085"
export HTTPS_PROXY="http://127.0.0.1:8085"
export NO_PROXY="localhost,127.0.0.1,::1"

# persist for every future terminal
cat >> ~/.bashrc <<'EOF'
export HTTP_PROXY="http://127.0.0.1:8085"
export HTTPS_PROXY="http://127.0.0.1:8085"
export NO_PROXY="localhost,127.0.0.1,::1"
EOF
source ~/.bashrc
```

#### APT (system package manager)

`sudo apt-get` runs as root and **does not** inherit your user's `HTTP_PROXY`. Configure it explicitly:

```bash
sudo tee /etc/apt/apt.conf.d/95xenrelayproxy >/dev/null <<'EOF'
Acquire::http::Proxy  "http://127.0.0.1:8085";
Acquire::https::Proxy "http://127.0.0.1:8085";
EOF

# remove later:
sudo rm /etc/apt/apt.conf.d/95xenrelayproxy
```

> If `apt-get update` complains about a self-signed certificate, install the CA first (Linux block in section 4 above), then re-run.

### macOS (zsh / Homebrew)

```zsh
# current shell only
export HTTP_PROXY="http://127.0.0.1:8085"
export HTTPS_PROXY="http://127.0.0.1:8085"
export ALL_PROXY="socks5://127.0.0.1:1080"   # optional, for SOCKS-aware tools
export NO_PROXY="localhost,127.0.0.1,::1"

# persist
cat >> ~/.zshrc <<'EOF'
export HTTP_PROXY="http://127.0.0.1:8085"
export HTTPS_PROXY="http://127.0.0.1:8085"
export NO_PROXY="localhost,127.0.0.1,::1"
EOF
source ~/.zshrc
```

#### Homebrew

`brew install` and `brew update` shell out to `git` and `curl`, so they obey the variables above. If you want the proxy applied to a single command only:

```zsh
HTTPS_PROXY="http://127.0.0.1:8085" HTTP_PROXY="http://127.0.0.1:8085" \
  brew update
```

If `brew` complains about TLS, the CA isn't trusted yet — install it via the macOS block in section 4.

#### System-wide (every GUI app and CLI tool)

```zsh
# enable on Wi-Fi (replace with "Ethernet" on a wired connection)
networksetup -setwebproxy        "Wi-Fi" 127.0.0.1 8085
networksetup -setsecurewebproxy  "Wi-Fi" 127.0.0.1 8085

# disable
networksetup -setwebproxystate        "Wi-Fi" off
networksetup -setsecurewebproxystate  "Wi-Fi" off
```

### Windows

**cmd.exe** (current session)
```cmd
set HTTP_PROXY=http://127.0.0.1:8085
set HTTPS_PROXY=http://127.0.0.1:8085
set NO_PROXY=localhost,127.0.0.1,::1
```

**cmd.exe** (persistent, all future terminals)
```cmd
setx HTTP_PROXY  "http://127.0.0.1:8085"
setx HTTPS_PROXY "http://127.0.0.1:8085"
setx NO_PROXY    "localhost,127.0.0.1,::1"
:: open a new terminal after this — setx does not affect the current one
```

**PowerShell** (current session)
```powershell
$env:HTTP_PROXY  = "http://127.0.0.1:8085"
$env:HTTPS_PROXY = "http://127.0.0.1:8085"
$env:NO_PROXY    = "localhost,127.0.0.1,::1"
```

**PowerShell** (persistent, current user)
```powershell
[Environment]::SetEnvironmentVariable("HTTP_PROXY",  "http://127.0.0.1:8085", "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://127.0.0.1:8085", "User")
[Environment]::SetEnvironmentVariable("NO_PROXY",    "localhost,127.0.0.1,::1","User")
```

To remove a persistent value, set it to `""` with the same command, or delete it under System Properties → Environment Variables.

### Cross-platform CLI tools

These commands work on every OS once your terminal is in the project root:

```bash
# git
git config --global http.proxy  http://127.0.0.1:8085
git config --global https.proxy http://127.0.0.1:8085
# unset:
git config --global --unset http.proxy
git config --global --unset https.proxy

# pip
pip config set global.proxy http://127.0.0.1:8085
# or one-shot:
pip install --proxy http://127.0.0.1:8085 <package>

# npm
npm config set proxy       http://127.0.0.1:8085
npm config set https-proxy http://127.0.0.1:8085
# unset:
npm config delete proxy
npm config delete https-proxy

# curl / wget — already obey HTTP_PROXY / HTTPS_PROXY
curl -x http://127.0.0.1:8085 https://example.com
```

### AI coding CLIs (claude, codex, gemini, copilot)

These tools read `HTTPS_PROXY` from the environment, so once the variables above are set they route through the proxy automatically. A few caveats:

- **Anthropic Claude Code (`claude`)** — works as-is. Uses `HTTPS_PROXY`.
- **Node-based CLIs** (Gemini CLI, GitHub Copilot CLI, OpenCode, etc.) need Node to trust the MITM CA. Point Node at the CA file:
  ```bash
  export NODE_EXTRA_CA_CERTS="$HOME/.config/XenRelayProxy/ca/ca.crt"   # Linux
  export NODE_EXTRA_CA_CERTS="$HOME/Library/Application Support/XenRelayProxy/ca/ca.crt"   # macOS
  ```
  ```powershell
  $env:NODE_EXTRA_CA_CERTS = "$env:AppData\XenRelayProxy\ca\ca.crt"   # Windows
  ```
- **OpenAI Codex CLI (`codex`)** — see the troubleshooting note below; the device-auth flow has a known interaction with Cloudflare.

#### Codex 530 / 400 errors

Symptom:
```
POST auth.openai.com/api/accounts/deviceauth/usercode — status=530 body=93b
Set-Cookie=1 names=[_cfuvid] dbg=[sc=1 hk=14 cl=0 ck=false ...]
```
or sporadic `400` from the same endpoint.

What's happening: `auth.openai.com` is fronted by Cloudflare. Cloudflare issues an anti-bot session cookie (`_cfuvid`) on the first request and expects every follow-up in the same OAuth flow to come from the same client and the same IP. When the Apps Script relay forwards the call:

1. The outbound IP belongs to a Google datacenter (UrlFetchApp), which Cloudflare treats as suspicious for OAuth flows.
2. Each request can land on a different Apps Script execution server with a different IP, so Cloudflare invalidates `_cfuvid` and returns **530** ("origin unreachable", really "I refuse to forward this").
3. Some endpoints additionally reject the request with **400** because `Transfer-Encoding: chunked` is collapsed into a `Content-Length` body inside the relay.

This is **not** a bug in XenRelayProxy — Anthropic's `x-api-key` API is unaffected because it's a single stateless POST with no session cookie. Codex's *device auth* flow is the only path that breaks.

Workarounds, in order of how painless they are:

1. **Use an API key instead of device auth.** Put it in your environment and Codex will skip the device-auth call entirely:
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```
2. **Sign in once on a direct connection** (different network, mobile hotspot, or after temporarily disabling the proxy), then copy the resulting `~/.codex/auth.json` onto the proxied machine. The bearer token works through the relay even when the initial OAuth handshake doesn't.
3. **Force the auth host to bypass the relay** by adding it to `direct_tunnel_hosts` in `config.json`:
   ```json
   "direct_tunnel_hosts": ["auth.openai.com", "chatgpt.com"]
   ```
   This only helps if a direct TLS connection to `auth.openai.com` actually completes from your network — i.e., it isn't blocked at the firewall. If direct is blocked, fall back to option 1 or 2.

### Quickly disable the proxy

```bash
# Linux/macOS
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
```
```cmd
:: Windows cmd
set HTTP_PROXY=
set HTTPS_PROXY=
set NO_PROXY=
:: persistent removal:
setx HTTP_PROXY  ""
setx HTTPS_PROXY ""
setx NO_PROXY    ""
```

---

## Multi-Account Configuration

A single Google account gives you 20,000 UrlFetch calls per day. For heavier usage deploy `Code.gs` to several accounts and list them in the `accounts` array:

```json
{
  "accounts": [
    { "label": "primary",  "script_id": "AKfyc1...", "account_type": "consumer",  "weight": 1.0, "daily_quota":  20000 },
    { "label": "burner-1", "script_id": "AKfyc2...", "account_type": "consumer",  "weight": 1.0, "daily_quota":  20000 },
    { "label": "work",     "script_id": "AKfyc3...", "account_type": "workspace", "weight": 2.0, "daily_quota": 100000 }
  ],
  "scheduler": {
    "strategy": "least_loaded",
    "cooloff_seconds": 900,
    "throttle_backoff_seconds": 60,
    "quota_safety_margin": 0.95
  }
}
```

| Strategy | Behavior |
|----------|----------|
| `least_loaded` *(default)* | Routes to the account with the lowest quota usage ratio. Best for even distribution. |
| `round_robin` | Classic round-robin over healthy accounts. |
| `weighted_random` | Random pick weighted by `weight`. Good when accounts have different capacities. |

> **Risk note:** Google may correlate accounts by IP, recovery email, phone, or signup pattern. Multiple accounts from the same residential IP is *not* a guaranteed quota multiplier and may trigger suspension of all linked accounts. Use carefully.

The desktop dashboard shows live state per account (calls today, % quota, cooloff status, error counts). You can also `GET http://_proxy_stats/` *through the proxy* for a JSON snapshot.

---

## Configuration Reference

| Field | Default | Description |
|-------|---------|-------------|
| `auth_key` | — | Shared secret with `Code.gs`. Required. |
| `google_ip` | `216.239.38.120` | Google fronting IP the proxy connects to. Use the in-app "Scan IPs" button to pick the fastest. |
| `front_domain` | `www.google.com` | SNI sent to the firewall. |
| `listen_host` / `listen_port` | `127.0.0.1` / `8085` | Where the HTTP proxy binds. |
| `socks5_enabled` / `socks5_port` | `true` / `1080` | SOCKS5 listener. |
| `lan_sharing` | `false` | When true, binds on `0.0.0.0` so other LAN devices can use the proxy. |
| `relay_timeout` | `90` | End-to-end relay timeout (seconds). Bumped from 25 → 90 to fit LLM-style upstreams. |
| `tls_connect_timeout` | `15` | TLS handshake budget for the front connection. |
| `tcp_connect_timeout` | `10` | TCP connect budget for direct/SNI-rewrite paths. |
| `max_request_body_bytes` | `100 MB` | Hard cap on a single relayed request body. |
| `max_response_body_bytes` | `5 GB` | Hard cap on a single relayed response (post-buffering). |
| `chunked_download_*` | see example | Parallel range-download tuning. |
| `cache_max_bytes` | `50 MB` | LRU cache for cacheable GETs. |
| `bypass_hosts` | `["localhost", ".local", ".lan", ".home.arpa"]` | Hosts that go direct (no MITM, no relay). |
| `direct_tunnel_hosts` | `[]` | Hosts to force-bypass even if they would otherwise route through the relay. |
| `direct_google_allow` / `direct_google_exclude` | see example | Which Google hosts may use the fast direct tunnel vs. must route through the relay. |
| `sni_rewrite_hosts` | YouTube + Google CDNs | Hosts that go through the SNI-rewrite path (no relay, but TLS to a Google IP). |
| `force_relay_sni_hosts` | `false` | When true, always use the relay for `sni_rewrite_hosts`. Useful if SNI rewrite is broken on your network. |
| `inject_permissive_cors` | `false` | Inject `Access-Control-Allow-*` on relayed responses. Last resort; breaks credentialed CORS flows. |
| `block_long_poll_paths` | see defaults | Path patterns that the proxy returns 502 for, to keep Apps Script from holding a 6-min slot. |
| `block_hosts` | `[]` | Hosts to refuse with HTTP 403. |
| `hosts` | `{}` | Manual `host → ip` overrides. |
| `metrics_max_hosts` | `256` | Bound on per-host metric cardinality. |

---

## Architecture

```
┌────────────┐    ┌──────────────────────┐    ┌────────────────┐    ┌──────────────────┐
│ Browser /  │───▶│  XenRelayProxy       │───▶│ Google fronting │───▶│ Apps Script /    │───▶ Internet
│ CLI tool   │    │  (HTTP / SOCKS5,     │    │ IP (SNI: ok)    │    │ optional self-   │
│            │◀───│   CONNECT MITM,      │◀───│ Host: relay     │◀───│ hosted relay     │◀──
└────────────┘    │   per-account sched) │    │  (encrypted)    │    └──────────────────┘
                  └──────────────────────┘
```

Every CONNECT goes through one of three paths picked by `internal/listener/routing.go`:

1. **Bypass** — loopback / private IP / `bypass_hosts` / `direct_tunnel_hosts` → plain TCP tunnel.
2. **Direct Google** — host is in `direct_google_allow` and not in `direct_google_exclude` → direct TLS to a Google IP, no relay.
3. **SNI rewrite** — host is in `sni_rewrite_hosts` → TLS to `front_domain`'s IP with the real Host header inside the encrypted stream.
4. **Full relay** — everything else → MITM, JSON-encode the request as protocol v2, ship to Apps Script.

---

## Project Layout

```
XenRelayProxy/
├── main.go                  # Wails entrypoint
├── app.go                   # Wails-bound API (Start/Stop/Status/SaveConfig/...)
├── cmd/xenrelayproxy-cli/   # Headless CLI for servers
├── pkg/relayvpn/            # Public API consumed by app.go and the CLI
├── internal/
│   ├── config/              # Config load/save/normalize/validate
│   ├── certstore/           # Cross-platform OS trust store integration
│   ├── mitm/                # On-the-fly TLS interception, per-host leaf certs
│   ├── listener/            # HTTP server, SOCKS5, routing, downloads
│   ├── relay/               # Apps Script protocol-v2 client
│   ├── scheduler/           # Multi-account selection + cooloff + persisted state
│   ├── frontscan/           # Front-IP latency scanner
│   ├── cache/               # Bounded LRU response cache
│   ├── obs/                 # Metrics, log ring buffer, download tracker
│   └── protocol/            # Protocol-v2 codec
├── apps_script/Code.gs      # The relay deployed to Google Apps Script
├── server_relay/relay.py    # Optional self-hosted relay (skip Apps Script entirely)
├── frontend/                # Wails React + TypeScript UI
└── build/                   # Wails build output (binaries, .deb, installer)
```

---

## Test

```bash
go test ./...
cd frontend && npm run build
```

The Go suite covers config validation, scheduler selection/cooloff, MITM cert generation, listener routing, the relay protocol codec, and the listener server.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|---------------------|
| `auth_key is unset or uses a known placeholder` | Pick a strong secret in **Settings**; the same value must be in `Code.gs`. |
| Browser shows certificate errors | Install the MITM CA (section 4). For Chrome/Edge, fully quit the browser before reopening — they cache certificates. |
| `502 Bad JSON` from the proxy | Apps Script returned HTML instead of JSON. Causes: wrong `script_id`, daily Apps Script quota exhausted, or you edited `Code.gs` and didn't redeploy. Create a **new deployment** after editing `Code.gs`. |
| `503` from the proxy — *all accounts cooled off* | Every relay account is throttled or quota-exhausted. Visit `http://_proxy_stats/` through the proxy for the full breakdown, add accounts, or wait for the daily quota reset (00:00 Pacific time). |
| Telegram works on HTTP proxy but not SOCKS5 | Expected — SOCKS5 clients resolve names locally and connect to raw IPs, so MTProto bytes hit a blocked IP that we can't tunnel or MITM. Use HTTP proxy mode for Telegram. |
| YouTube videos won't play | The SNI-rewrite path uses Google's frontend IP which enforces SafeSearch. Either remove YouTube domains from `sni_rewrite_hosts`, or set `force_relay_sni_hosts: true` and route YouTube through the relay (slower, costs quota). |
| Codex device-auth fails with 530 / 400 from `auth.openai.com` | Cloudflare doesn't like Apps Script's outbound IPs for OAuth flows. See the **Codex 530 / 400 errors** sub-section above. Use an API key, copy a pre-existing `~/.codex/auth.json`, or add `auth.openai.com` to `direct_tunnel_hosts`. |
| Long-poll endpoint hangs / wastes a slot | It's already on the `block_long_poll_paths` deny list — but if you hit a new one, add it there and the proxy will return 502 immediately instead of letting Apps Script burn its 6-minute budget. |

---

## Security Tips

- Don't share `config.json` or the `ca/` folder — they contain your auth key and private CA key.
- Change the default `AUTH_KEY` in `Code.gs` before deploying.
- Keep `listen_host` as `127.0.0.1` unless you specifically want LAN sharing.
- Apps Script deployments are capped at 20,000 UrlFetch calls / 24 h (consumer) or 100,000 (workspace).

---

## License

MIT.
