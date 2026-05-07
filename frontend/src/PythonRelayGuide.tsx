import React, { useState } from "react";
import { Check, Copy, ExternalLink, Server, Terminal as TerminalIcon } from "lucide-react";
import { useT } from "./i18n";

/**
 * Side-guide for the optional server-side Python relay. NOT a wizard step —
 * a static reference page accessible from the sidebar.
 */
export default function PythonRelayGuide() {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    }).catch(() => {});
  }

  const relaySnippet = `#!/usr/bin/env python3
# server_relay/relay.py — drop on your VPS, run alongside your existing services.
# Apps Script POSTs JSON-encoded fetch requests; relay.py executes them and
# returns the response. Target sites see your VPS IP, not Google's.

import os, base64, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request as ur, error as ue

AUTH_KEY = os.environ.get("RELAY_AUTH_KEY", "CHANGE_ME")
PORT = int(os.environ.get("PORT", "9443"))

class H(BaseHTTPRequestHandler):
  def do_POST(self):
    n = int(self.headers.get("Content-Length") or 0)
    body = json.loads(self.rfile.read(n))
    if body.get("k") != AUTH_KEY:
      self.send_response(403); self.end_headers(); return
    req = ur.Request(body["u"], method=body.get("m","GET"),
                     data=base64.b64decode(body.get("b","")) or None,
                     headers=body.get("h",{}))
    try:
      r = ur.urlopen(req, timeout=25)
      out = {"s": r.status, "h": dict(r.headers),
             "b": base64.b64encode(r.read()).decode()}
    except ue.HTTPError as e:
      out = {"s": e.code, "h": dict(e.headers),
             "b": base64.b64encode(e.read()).decode()}
    self.send_response(200)
    self.send_header("Content-Type","application/json")
    self.end_headers()
    self.wfile.write(json.dumps(out).encode())

ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()`;

  const codegsSnippet = `// In your deployed apps_script/Code.gs, set:
const RELAY_URL = "https://your-vps.example.com:9443/relay";
const RELAY_KEY = "<same key as RELAY_AUTH_KEY on your VPS>";`;

  return (
    <div className="guide-page">
      <div className="guide-banner">
        <Server size={16} />
        <div>
          <strong>{t("guide.python.title")}</strong>
          <span className="guide-pill">{t("guide.python.optional")}</span>
        </div>
      </div>

      <p className="guide-lead">{t("guide.python.body")}</p>

      <div className="guide-section">
        <h3>{t("guide.python.whyTitle")}</h3>
        <ul>
          <li>{t("guide.python.why1")}</li>
          <li>{t("guide.python.why2")}</li>
          <li>{t("guide.python.why3")}</li>
        </ul>
      </div>

      <div className="guide-section">
        <h3>{t("guide.python.deployTitle")}</h3>
        <ol>
          <li>{t("guide.python.deploy1")}</li>
          <li>{t("guide.python.deploy2")}</li>
          <li>{t("guide.python.deploy3")}</li>
          <li>{t("guide.python.deploy4")}</li>
        </ol>

        <div className="guide-codeblock">
          <div className="guide-codeblock-head">
            <TerminalIcon size={12} />
            <span className="mono-sm">relay.py</span>
            <button className="wiz-iconbtn small" onClick={() => copy("relay", relaySnippet)}>
              {copied === "relay" ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
            </button>
          </div>
          <pre><code>{relaySnippet}</code></pre>
        </div>
      </div>

      <div className="guide-section">
        <h3>{t("guide.python.wireTitle")}</h3>
        <p>{t("guide.python.wireBody")}</p>
        <div className="guide-codeblock">
          <div className="guide-codeblock-head">
            <span className="mono-sm">Code.gs</span>
            <button className="wiz-iconbtn small" onClick={() => copy("codegs", codegsSnippet)}>
              {copied === "codegs" ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
            </button>
          </div>
          <pre><code>{codegsSnippet}</code></pre>
        </div>
      </div>

      <div className="guide-footer">
        <a
          href="https://github.com/AlimorshedZade/MasterHttpRelayVPN/blob/main/docs/11-server-side-relay.md"
          target="_blank"
          rel="noreferrer"
          className="guide-extlink"
        >
          {t("guide.python.docsLink")} <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
