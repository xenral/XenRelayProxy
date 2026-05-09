import React, { useState } from "react";
import { Check, Copy, ExternalLink, Server, Terminal as TerminalIcon } from "lucide-react";
import { useT } from "./i18n";
import relaySource from "../../server_relay/relay.py?raw";

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

  const relaySnippet = relaySource;

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
