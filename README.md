# XenRelayProxy

XenRelayProxy is a Go/Wails desktop rewrite of the Python
MasterHttpRelayVPN relay proxy. It runs a local HTTP/SOCKS5 proxy, relays
HTTP requests through a Google Apps Script deployment using a cleaned v2 JSON
protocol, and exposes a desktop control surface for accounts, logs, metrics,
and certificate management.

## Current milestone

This repository contains the first desktop milestone:

- Wails v2 + React TypeScript desktop shell.
- Go core with config validation, account scheduler, Apps Script relay,
  HTTP proxy, CONNECT MITM, SOCKS5 listener, response cache, stats, and logs.
- Redeployable `apps_script/Code.gs` using protocol v2:
  - single response: `{s,h,b,e}`
  - batch response: `{r:[...]}`
- Headless CLI for smoke testing the core without launching Wails.

## Prerequisites

Install Go 1.22+ and Wails v2:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Then install frontend dependencies:

```bash
cd frontend
npm install
```

## Run

Copy `config.example.json` to `config.json`, set your Apps Script deployment
ID and auth key, redeploy `apps_script/Code.gs` with the same key, then run:

```bash
wails dev
```

For headless smoke testing:

```bash
go run ./cmd/xenrelayproxy-cli -config config.json
```

## Test

```bash
go test ./...
cd frontend && npm run build
```

