import { useT } from "@/i18n";
import { CopyCode } from "@/components/ui/copy-code";
import { Step, StepList } from "../_step";

export function FirefoxGuide({ certPath }: { certPath: string }) {
  const t = useT();
  const path = certPath || "~/Library/Application Support/XenRelayProxy/ca/ca.crt";
  return (
    <StepList>
      <Step num="!" warn title={t("cert.firefox.warnTitle")}>
        <p>{t("cert.firefox.warnBody")}</p>
      </Step>
      <Step num="1" title={t("cert.firefox.openTitle")}>
        <p>
          {t("cert.firefox.openBodyA")}
          <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-ink-1">
            about:preferences#privacy
          </code>
          {t("cert.firefox.openBodyB")}
          <strong className="text-ink-1">{t("cert.firefox.viewCerts")}</strong>
        </p>
      </Step>
      <Step num="2" title={t("cert.firefox.importTitle")}>
        <p>
          {t("cert.firefox.importBodyA")}
          <strong className="text-ink-1">{t("cert.firefox.authorities")}</strong>
          {t("cert.firefox.importBodyB")}
          <strong className="text-ink-1">{t("cert.firefox.import")}</strong>
          {t("cert.firefox.importBodyC")}
        </p>
        <CopyCode label="path" code={path} />
      </Step>
      <Step num="3" title={t("cert.firefox.trustTitle")}>
        <p>
          {t("cert.firefox.trustBodyA")}
          <em className="text-signal">{t("cert.firefox.trustText")}</em>
          {t("cert.firefox.trustBodyB")}
          <strong className="text-ink-1">{t("cert.firefox.ok")}</strong>.
        </p>
      </Step>
      <Step num="4" title={t("cert.firefox.restartTitle")}>
        <p>{t("cert.firefox.restartBody")}</p>
      </Step>
    </StepList>
  );
}
