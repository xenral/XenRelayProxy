import React from "react";
import { Cloud, ExternalLink } from "lucide-react";
import { useT } from "./i18n";

const DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAlimorshedZade%2FXenRelayProxy&root-directory=vercel&env=RELAY_TOKEN&envDescription=Shared%20secret%20your%20XenRelayProxy%20client%20presents.";

/**
 * Side-guide for the Vercel relay backend. Mirrors PythonRelayGuide —
 * a static reference page accessible from the sidebar — and walks the
 * user through deploying the /vercel function and wiring it into the
 * Wizard. The Wizard itself has the in-line happy path; this page
 * stays in the sidebar for users who want the full picture afterwards.
 */
export default function VercelRelayGuide() {
  const t = useT();

  return (
    <div className="guide-page">
      <div className="guide-banner">
        <Cloud size={16} />
        <div>
          <strong>{t("guide.vercel.title")}</strong>
          <span className="guide-pill">{t("guide.vercel.optional")}</span>
        </div>
      </div>

      <p className="guide-lead">{t("guide.vercel.body")}</p>

      <div className="guide-section">
        <h3>{t("guide.vercel.whyTitle")}</h3>
        <ul>
          <li>{t("guide.vercel.why1")}</li>
          <li>{t("guide.vercel.why2")}</li>
          <li>{t("guide.vercel.why3")}</li>
        </ul>
      </div>

      <div className="guide-section">
        <h3>{t("guide.vercel.deployTitle")}</h3>
        <ol>
          <li>{t("guide.vercel.deploy1")}</li>
          <li>{t("guide.vercel.deploy2")}</li>
          <li>{t("guide.vercel.deploy3")}</li>
          <li>{t("guide.vercel.deploy4")}</li>
        </ol>

        <a
          href={DEPLOY_URL}
          target="_blank"
          rel="noreferrer"
          className="wiz-btn primary"
          style={{ alignSelf: "flex-start", marginTop: 4 }}
        >
          <Cloud size={14} />
          <span>{t("guide.vercel.deployCta")}</span>
          <ExternalLink size={12} />
        </a>
      </div>

      <div className="guide-section">
        <h3>{t("guide.vercel.envTitle")}</h3>
        <p>{t("guide.vercel.envBody")}</p>
      </div>

      <div className="guide-section">
        <h3>{t("guide.vercel.mixTitle")}</h3>
        <p>{t("guide.vercel.mixBody")}</p>
      </div>
    </div>
  );
}
