import { ExternalLink, FileText, KeyRound, Server } from "lucide-react";
import { useT } from "@/i18n";
import { useStatus } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AboutPage() {
  const t = useT();
  const { data: status } = useStatus();
  const version = status?.version || "1.4.1";

  return (
    <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
      <Card className="overflow-hidden p-7">
        <div className="flex items-start gap-5">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-signal/40 bg-signal/10">
            <KeyRound className="size-6 text-signal" />
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-signal shadow-[0_0_12px_hsl(var(--signal))]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="display text-[36px] leading-none tracking-tightest text-ink-1">XenRelayProxy</h2>
              <Badge tone="signal">v{version}</Badge>
            </div>
            <p className="mt-3 text-[14px] text-ink-2 leading-relaxed max-w-2xl">{t("about.tagline")}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Server className="size-3.5 text-ink-3" />
            <span className="text-[13px] font-medium text-ink-1">{t("about.defaults")}</span>
          </div>
          <ul className="mt-4 space-y-2 text-[12.5px] text-ink-2">
            <Row label={t("about.httpProxy")} value="127.0.0.1:8085" />
            <Row label={t("about.socks5Proxy")} value="127.0.0.1:1080" />
            <Row
              label={t("about.stats")}
              value="http://_proxy_stats/"
              hint={t("about.statsThrough")}
            />
          </ul>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <FileText className="size-3.5 text-ink-3" />
            <span className="text-[13px] font-medium text-ink-1">{t("about.dataDir")}</span>
          </div>
          <ul className="mt-4 space-y-2 text-[12px] text-ink-2 font-mono">
            <li className="break-all">~/Library/Application Support/XenRelayProxy/config.json</li>
            <li className="break-all">~/Library/Application Support/XenRelayProxy/ca/</li>
          </ul>
        </Card>
      </div>

      <Card className="p-5 flex items-center justify-between gap-4">
        <div>
          <span className="label-kicker">repository</span>
          <p className="mt-1 text-[13px] text-ink-2">
            Source on GitHub — issues, releases, full docs.
          </p>
        </div>
        <a
          href="https://github.com/AlimorshedZade/MasterHttpRelayVPN"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] text-ink-1 hover:bg-bg-inset transition-colors"
        >
          MasterHttpRelayVPN
          <ExternalLink className="size-3.5" />
        </a>
      </Card>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line-subtle/60 pb-2 last:border-b-0 last:pb-0">
      <span className="text-ink-3">
        {label}
        {hint && <span className="block text-[11px] text-ink-3/70">{hint}</span>}
      </span>
      <code className="font-mono text-[11.5px] text-ink-1 tabular-nums">{value}</code>
    </li>
  );
}
