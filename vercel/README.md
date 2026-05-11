# XenRelayProxy — Vercel relay backend

A drop-in alternative to the Google Apps Script backend. The Wails
desktop app can route some or all of its traffic through a Vercel
function instead of (or alongside) Apps Script — useful when:

- you keep hitting the Apps Script daily quota,
- you need a streaming-friendly response path (Vercel's Fluid Compute
  bypasses the 4.5 MB body cap),
- you don't want a Google account in the loop, or
- you just want a simpler 30-second deploy.

The wire format is identical to Apps Script (same `Envelope` / `Reply`,
same `{e: "too_large"}` signal that triggers the chunked Range
fallback), so the rest of the proxy stack — scheduler, MITM, downloads —
works without any client-side changes.

---

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAlimorshedZade%2FXenRelayProxy&root-directory=vercel&env=RELAY_TOKEN&envDescription=Shared%20secret%20your%20XenRelayProxy%20client%20presents%20on%20every%20call.%20Generate%20one%20in%20the%20Wizard%20%E2%80%94%20it%20goes%20into%20both%20places.)

When prompted:

1. Pick a project name (anything — it just becomes part of the URL).
2. Set `RELAY_TOKEN` to the same auth key you generated in the
   XenRelayProxy Wizard. The function rejects every request whose
   `X-Relay-Token` header doesn't match.
3. Click **Deploy**.

About 30 seconds later you'll have a `https://<name>.vercel.app` URL.
Paste it into the Wizard's *Vercel mode* card and click **Test
connection**.

---

## Configuration

| Env var          | Required | Default        | Effect                                                                                          |
|------------------|:--------:|----------------|-------------------------------------------------------------------------------------------------|
| `RELAY_TOKEN`    |    ✅    | —              | Shared secret. Must match `auth_key` in your local config.                                       |
| `MAX_BODY_BYTES` |          | `26214400` (25 MB) | Upstream responses bigger than this get an `{e:"too_large"}` reply, so the Go side falls back to chunked Range fetches. |

You can change the region by editing `vercel.json` after the initial
deploy (`iad1` is the default). For multi-region failover, deploy the
function several times under different `*.vercel.app` URLs and add each
as a separate account in the Wizard — the scheduler will load-balance
between them.

---

## Endpoints

- `POST /api/tunnel` — single envelope. Returns one `Reply`.
- `POST /api/batch`  — batch of envelopes (`{q: Envelope[]}`). Returns
  `{r: Reply[]}` mirroring Apps Script's batch shape.

Both expect `X-Relay-Token` in the request headers and reject anything
else with a 401.

---

## Local development

```sh
cd vercel
npm install -D vercel
RELAY_TOKEN=test123 npx vercel dev
```

That serves the function at `http://localhost:3000`. Point a draft
config at it (`mode: "vercel"`, `vercel_url:
"http://localhost:3000"`, `auth_key: "test123"`) and run the Wails app
to drive traffic through the local relay.
