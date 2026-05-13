import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Step, StepList } from "../_step";

export function AutoGuide({
  trusted, onInstall, installing,
}: {
  trusted: boolean;
  onInstall: () => void;
  installing: boolean;
}) {
  const t = useT();
  return (
    <StepList>
      <Step num="1" title={t("cert.auto.title")}>
        <p>{t("cert.auto.body")}</p>
        <div className="pt-2">
          {trusted ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3" />
              {t("cert.alreadyInstalled")}
            </Badge>
          ) : (
            <Button variant="primary" onClick={onInstall} disabled={installing}>
              {installing ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {t("cert.install")}
            </Button>
          )}
        </div>
      </Step>
      <Step num="!" warn title={t("cert.auto.firefoxNote.title")}>
        <p>
          {t("cert.auto.firefoxNote.bodyA")}
          <strong className="text-ink-1">{t("cert.tab.firefox")}</strong>
          {t("cert.auto.firefoxNote.bodyB")}
        </p>
      </Step>
      <Step num="2" title={t("cert.auto.restart.title")}>
        <p>{t("cert.auto.restart.body")}</p>
      </Step>
    </StepList>
  );
}
