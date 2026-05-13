import { ExternalLink, Server, Terminal as TerminalIcon } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyCode } from "@/components/ui/copy-code";
import { Step, StepList } from "../certificate/_step";
import relaySource from "../../../../server_relay/relay.py?raw";

export default function PythonRelayPage() {
  const t = useT();

  const codegsSnippet = `// In your deployed apps_script/Code.gs, set:
const RELAY_URL = "https://your-vps.example.com:9443/relay";
const RELAY_KEY = "<same key as RELAY_AUTH_KEY on your VPS>";`;

  return (
    <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
      <Card className="overflow-hidden p-5 sm:p-6 md:p-7">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-info/40 bg-info/10 sm:h-12 sm:w-12">
            <Server className="size-4 text-info sm:size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h2 className="display text-[22px] leading-none tracking-tightest text-ink-1 sm:text-[26px] md:text-[28px]">
                {t("guide.python.title")}
              </h2>
              <Badge tone="info">{t("guide.python.optional")}</Badge>
            </div>
            <p className="mt-3 text-[13px] text-ink-2 leading-relaxed max-w-2xl sm:text-[13.5px]">
              {t("guide.python.body")}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5 md:p-6">
        <span className="label-kicker">{t("guide.python.whyTitle")}</span>
        <ul className="mt-3 space-y-2 text-[13px] text-ink-2 leading-relaxed">
          {[t("guide.python.why1"), t("guide.python.why2"), t("guide.python.why3")].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-signal" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div>
        <span className="label-kicker">{t("guide.python.deployTitle")}</span>
        <div className="mt-3">
          <StepList>
            <Step num="1" title={t("guide.python.deploy1")}>
              <p>{t("guide.python.deploy2")}</p>
            </Step>
            <Step num="2" title={t("guide.python.deploy3")}>
              <p>{t("guide.python.deploy4")}</p>
              <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3 font-mono">
                <TerminalIcon className="size-3" />
                <span>relay.py</span>
              </div>
              <CopyCode label="relay.py" code={relaySource} />
            </Step>
            <Step num="3" title={t("guide.python.wireTitle")}>
              <p>{t("guide.python.wireBody")}</p>
              <CopyCode label="Code.gs" code={codegsSnippet} />
            </Step>
          </StepList>
        </div>
      </div>

      <Card className="p-5">
        <a
          href="https://github.com/AlimorshedZade/MasterHttpRelayVPN/blob/main/docs/11-server-side-relay.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-[12.5px] text-signal hover:underline"
        >
          {t("guide.python.docsLink")}
          <ExternalLink className="size-3.5" />
        </a>
      </Card>
    </div>
  );
}
