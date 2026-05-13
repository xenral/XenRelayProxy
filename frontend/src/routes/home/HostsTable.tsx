import { Globe2 } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { fmtLatency } from "@/lib/format";
import type { HostMetric } from "@/types/domain";

export function HostsTable({ hosts }: { hosts: HostMetric[] }) {
  const t = useT();

  if (hosts.length === 0) {
    return (
      <EmptyState
        icon={<Globe2 className="size-5" />}
        title={t("dash.noTraffic")}
        description="Once traffic flows through the relay, per-host telemetry surfaces here."
      />
    );
  }

  const max = Math.max(...hosts.map((h) => h.requests), 1);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle/70 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Globe2 className="size-3.5 text-ink-2" />
          <span className="text-[13px] font-medium text-ink-1">{t("dash.host")}</span>
        </div>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
          {hosts.length} hosts · live
        </span>
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden divide-y divide-line-subtle/60 sm:block">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-6 px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
          <span>host</span>
          <span className="text-right">{t("dash.requests")}</span>
          <span className="text-right">{t("dash.errors")}</span>
          <span className="text-right">{t("dash.avgLatency")}</span>
        </div>
        {hosts.map((h) => {
          const pct = Math.min(100, (h.requests / max) * 100);
          const errRatio = h.requests > 0 ? h.errors / h.requests : 0;
          return (
            <div key={h.host} className="relative grid grid-cols-[1fr_auto_auto_auto] gap-6 px-5 py-3 hover:bg-bg-inset/40 transition-colors">
              <div
                className="absolute inset-y-0 left-0 bg-signal/[0.04] transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
              <span className="relative truncate font-mono text-[12.5px] text-ink-1" title={h.host}>
                {h.host}
              </span>
              <span className="relative text-right font-mono text-[12.5px] tabular-nums text-ink-1">
                {h.requests.toLocaleString()}
              </span>
              <span
                className={`relative text-right font-mono text-[12.5px] tabular-nums ${errRatio > 0.05 ? "text-danger" : "text-ink-3"}`}
              >
                {h.errors}
              </span>
              <span className="relative text-right font-mono text-[12.5px] tabular-nums text-ink-2">
                {fmtLatency(h.avg_latency_ms)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Mobile stacked card layout */}
      <ul className="divide-y divide-line-subtle/60 sm:hidden">
        {hosts.map((h) => {
          const pct = Math.min(100, (h.requests / max) * 100);
          const errRatio = h.requests > 0 ? h.errors / h.requests : 0;
          return (
            <li key={h.host} className="relative px-4 py-3">
              <div
                className="absolute inset-y-0 left-0 bg-signal/[0.04] transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
              <div className="relative">
                <div className="truncate font-mono text-[12.5px] text-ink-1" title={h.host}>
                  {h.host}
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums">
                  <span className="text-ink-2">
                    {h.requests.toLocaleString()}{" "}
                    <span className="text-ink-3">{t("dash.requests")}</span>
                  </span>
                  <span className={errRatio > 0.05 ? "text-danger" : "text-ink-3"}>
                    {h.errors} {t("dash.errors")}
                  </span>
                  <span className="text-ink-2">{fmtLatency(h.avg_latency_ms)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
