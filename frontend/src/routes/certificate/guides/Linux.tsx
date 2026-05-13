import { useT } from "@/i18n";
import { CopyCode } from "@/components/ui/copy-code";
import { Step, StepList } from "../_step";

export function LinuxGuide({ certPath }: { certPath: string }) {
  const t = useT();
  const path = certPath || "/path/to/ca.crt";
  return (
    <StepList>
      <Step num="1" title={t("cert.linux.debianTitle")}>
        <CopyCode
          label="bash"
          code={`sudo cp "${path}" /usr/local/share/ca-certificates/xenrelayproxy.crt\nsudo update-ca-certificates`}
        />
      </Step>
      <Step num="2" title={t("cert.linux.fedoraTitle")}>
        <CopyCode
          label="bash"
          code={`sudo cp "${path}" /etc/pki/ca-trust/source/anchors/xenrelayproxy.crt\nsudo update-ca-trust`}
        />
      </Step>
      <Step num="3" title={t("cert.linux.firefoxTitle")}>
        <p>
          {t("cert.linux.firefoxBodyA")}
          <strong className="text-ink-1">{t("cert.tab.firefox")}</strong>
          {t("cert.linux.firefoxBodyB")}
        </p>
      </Step>
    </StepList>
  );
}
