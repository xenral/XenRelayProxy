import { useT } from "@/i18n";
import { CopyCode } from "@/components/ui/copy-code";
import { Step, StepList } from "../_step";

export function WindowsGuide({ certPath }: { certPath: string }) {
  const t = useT();
  return (
    <StepList>
      <Step num="1" title={t("cert.windows.autoTitle")}>
        <p>
          {t("cert.windows.autoBodyA")}
          <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-ink-1">
            certutil -addstore -user Root
          </code>
          {t("cert.windows.autoBodyB")}
        </p>
      </Step>
      <Step num="2" title={t("cert.windows.guiTitle")}>
        <p>
          {t("cert.windows.guiBodyA")}
          <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-ink-1">Win+R</code>
          {t("cert.windows.guiBodyB")}
          <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-ink-1">certmgr.msc</code>
          {t("cert.windows.guiBodyC")}
          <em className="text-ink-1">{t("cert.windows.trustedRoot")}</em>
          {t("cert.windows.guiBodyD")}
        </p>
      </Step>
      <Step num="3" title={t("cert.windows.cliTitle")}>
        <CopyCode
          label="cmd"
          code={`certutil -addstore Root "${certPath || "C:\\path\\to\\ca.crt"}"`}
        />
      </Step>
    </StepList>
  );
}
