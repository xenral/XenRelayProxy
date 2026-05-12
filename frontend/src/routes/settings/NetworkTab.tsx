import { useState } from "react";
import { Globe2, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { useScanIPs } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { SettingsCard, TextField } from "./_shared";
import type { Config, ScanResult } from "@/types/domain";
import { cn } from "@/lib/utils";

interface Props {
  cfg: Config;
  setCfg: (c: Config) => void;
}

export function NetworkTab({ cfg, setCfg }: Props) {
  const t = useT();
  const scan = useScanIPs();
  const [results, setResults] = useState<ScanResult[]>([]);

  async function runScan() {
    try {
      const r = await scan.mutateAsync();
      setResults(r);
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        kicker="endpoints"
        title="Google Front"
        description="The IP and SNI hostname the proxy uses to reach Apps Script."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t("settings.googleIP")}
            value={cfg.google_ip}
            onChange={(v) => setCfg({ ...cfg, google_ip: v })}
          />
          <TextField
            label={t("settings.frontDomain")}
            value={cfg.front_domain}
            onChange={(v) => setCfg({ ...cfg, front_domain: v })}
          />
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={runScan} disabled={scan.isPending}>
            {scan.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("settings.scan")}
          </Button>
          {results.length > 0 && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
              {results.length} candidates
            </span>
          )}
        </div>

        {results.length > 0 && (
          <ul className="grid gap-1.5 md:grid-cols-2">
            {results.slice(0, 10).map((r) => (
              <li
                key={r.ip}
                onClick={() => {
                  setCfg({ ...cfg, google_ip: r.ip });
                  toast.info(t("toast.googleIPSet", { ip: r.ip }));
                }}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                  r.recommend
                    ? "border-signal/40 bg-signal/8 hover:bg-signal/12"
                    : "border-line-subtle hover:bg-bg-inset",
                  cfg.google_ip === r.ip && "ring-2 ring-signal/60 ring-offset-2 ring-offset-bg-base",
                )}
              >
                <span className="flex items-center gap-2 font-mono text-[12.5px] text-ink-1">
                  {r.recommend ? (
                    <CheckCircle2 className="size-3.5 text-signal" />
                  ) : (
                    <Globe2 className="size-3.5 text-ink-3" />
                  )}
                  {r.ip}
                </span>
                <span className={cn("font-mono text-[11px] tabular-nums", r.ok ? "text-success" : "text-danger")}>
                  {r.ok ? `${r.rtt_ms.toFixed(1)} ms` : r.error}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        kicker="listeners"
        title="Local proxy bind"
        description="Where the local HTTP and SOCKS5 proxies listen. Keep on 127.0.0.1 unless you intentionally expose them on a LAN."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label={t("settings.listenHost")}
            value={cfg.listen_host}
            onChange={(v) => setCfg({ ...cfg, listen_host: v })}
          />
          <TextField
            label={t("settings.httpPort")}
            type="number"
            value={cfg.listen_port}
            onChange={(v) => setCfg({ ...cfg, listen_port: Number(v) })}
          />
          <TextField
            label={t("settings.socks5Port")}
            type="number"
            value={cfg.socks5_port}
            onChange={(v) => setCfg({ ...cfg, socks5_port: Number(v) })}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
