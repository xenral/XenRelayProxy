import { Cloud, ExternalLink } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Step, StepList } from "../certificate/_step";
import { VERCEL_DEPLOY_URL } from "../wizard/_utils";

export default function VercelRelayPage() {
  const t = useT();

  return (
    <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
      <Card className="overflow-hidden p-7">
        <div className="flex items-start gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-signal/40 bg-signal/10">
            <Cloud className="size-5 text-signal" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="display text-[28px] leading-none tracking-tightest text-ink-1">
                {t("guide.vercel.title")}
              </h2>
              <Badge tone="signal">{t("guide.vercel.optional")}</Badge>
            </div>
            <p className="mt-3 text-[13.5px] text-ink-2 leading-relaxed max-w-2xl">
              {t("guide.vercel.body")}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <span className="label-kicker">{t("guide.vercel.whyTitle")}</span>
        <ul className="mt-3 space-y-2 text-[13px] text-ink-2 leading-relaxed">
          {[t("guide.vercel.why1"), t("guide.vercel.why2"), t("guide.vercel.why3")].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-signal" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div>
        <span className="label-kicker">{t("guide.vercel.deployTitle")}</span>
        <div className="mt-3">
          <StepList>
            <Step num="1" title={t("guide.vercel.deploy1")}>
              <p>{t("guide.vercel.deploy2")}</p>
            </Step>
            <Step num="2" title={t("guide.vercel.deploy3")}>
              <p>{t("guide.vercel.deploy4")}</p>
              <Button asChild variant="primary" className="mt-2">
                <a href={VERCEL_DEPLOY_URL} target="_blank" rel="noreferrer">
                  <Cloud />
                  {t("guide.vercel.deployCta")}
                  <ExternalLink />
                </a>
              </Button>
            </Step>
            <Step num="3" title={t("guide.vercel.envTitle")}>
              <p>{t("guide.vercel.envBody")}</p>
            </Step>
            <Step num="4" title={t("guide.vercel.mixTitle")}>
              <p>{t("guide.vercel.mixBody")}</p>
            </Step>
          </StepList>
        </div>
      </div>
    </div>
  );
}
