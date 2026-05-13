import { useT } from "@/i18n";
import { Input } from "@/components/ui/input";
import { Field, SettingsCard } from "./_shared";
import type { Config } from "@/types/domain";

interface Props {
  cfg: Config;
  setCfg: (c: Config) => void;
}

function arrToCSV(a?: string[]) {
  return (a ?? []).join(", ");
}

function csvToArr(s: string) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function AdvancedTab({ cfg, setCfg }: Props) {
  const t = useT();
  return (
    <div className="space-y-4">
      <SettingsCard
        kicker="bypass"
        title="Direct tunnel & blocklist"
        description="Hosts the relay should skip or refuse outright."
      >
        <Field label={t("settings.directTunnelHosts")} hint={t("settings.directTunnelHostsHelp")}>
          <Input
            value={arrToCSV(cfg.direct_tunnel_hosts)}
            onChange={(e) => setCfg({ ...cfg, direct_tunnel_hosts: csvToArr(e.target.value) })}
            placeholder="api.x.com, ads-api.x.com"
            className="font-mono text-[12px]"
          />
        </Field>
        <Field label={t("settings.blockHosts")}>
          <Input
            value={arrToCSV(cfg.block_hosts)}
            onChange={(e) => setCfg({ ...cfg, block_hosts: csvToArr(e.target.value) })}
            placeholder="ads.example.com, tracker.example.com"
            className="font-mono text-[12px]"
          />
        </Field>
      </SettingsCard>

      <SettingsCard
        kicker="scheduler"
        title="Account rotation"
        description="Read-only summary — strategy and cooloff defaults applied to all accounts."
      >
        <dl className="grid gap-y-3 gap-x-6 md:grid-cols-2 text-[13px]">
          <KV label="Strategy" value={cfg.scheduler.strategy} />
          <KV label="Quota safety margin" value={`${(cfg.scheduler.quota_safety_margin * 100).toFixed(0)}%`} />
          <KV label="Cooloff" value={`${cfg.scheduler.cooloff_seconds}s`} />
          <KV label="Throttle backoff" value={`${cfg.scheduler.throttle_backoff_seconds}s`} />
          <KV label="Keepalive interval" value={`${cfg.scheduler.keepalive_interval_seconds}s`} />
          <KV label="State persist" value={`${cfg.scheduler.state_persist_interval_seconds}s`} />
          <KV label="Prewarm on start" value={cfg.scheduler.prewarm_on_start ? "yes" : "no"} />
          <KV label="State file" value={cfg.scheduler.state_file} mono />
        </dl>
      </SettingsCard>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle/60 pb-2">
      <dt className="text-ink-3 text-[12.5px]">{label}</dt>
      <dd className={`text-ink-1 ${mono ? "font-mono text-[11.5px]" : ""}`}>{value}</dd>
    </div>
  );
}
