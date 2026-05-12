import { useT } from "@/i18n";
import { CopyCode } from "@/components/ui/copy-code";
import { Step, StepList } from "../_step";

export function MacOSGuide({ certPath }: { certPath: string }) {
  const t = useT();
  const path = certPath || "~/Library/Application Support/XenRelayProxy/ca/ca.crt";
  return (
    <StepList>
      <Step num="1" title={t("cert.macos.optionATitle")}>
        <p>{t("cert.macos.optionABody")}</p>
      </Step>
      <Step num="2" title={t("cert.macos.optionBTitle")}>
        <CopyCode
          label="zsh"
          code={`security add-trusted-cert -r trustRoot \\\n  -k ~/Library/Keychains/login.keychain-db \\\n  "${path}"`}
        />
      </Step>
      <Step num="3" title={t("cert.macos.optionCTitle")}>
        <p>
          {t("cert.macos.optionCBodyA")}
          <strong className="text-ink-1">Keychain Access</strong>
          {t("cert.macos.optionCBodyB")}
          <em className="text-signal">{t("cert.macos.alwaysTrust")}</em>
          {t("cert.macos.optionCBodyC")}
        </p>
      </Step>
    </StepList>
  );
}
