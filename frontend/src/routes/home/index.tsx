import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity, ArrowDown, ArrowUp, CheckCircle2, Clock, Gauge,
  Globe2, Loader2, Server, ShieldCheck, ShieldOff,
  Wifi, WifiOff, X, Zap,
} from "lucide-react";
import { useT } from "@/i18n";
import { useStats, useStatus, useStartRelay, useStopRelay } from "@/lib/queries";
import { cancelDownload } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtBytes, fmtBytesPerSec, fmtLatency, fmtUptime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ConnectionHero } from "./ConnectionHero";
import { StatTile } from "./StatTile";
import { HostsTable } from "./HostsTable";

export default function HomePage() {
  const t = useT();
  const { data: status } = useStatus();
  const { data: stats } = useStats();
  const start = useStartRelay();
  const stop = useStopRelay();

  const running = !!status?.running;
  const connecting = start.isPending || stop.isPending;

  const totalReq = stats?.metrics.total_requests ?? 0;
  const totalErr = stats?.metrics.total_errors ?? 0;
  const successPct = totalReq > 0 ? Math.round(((totalReq - totalErr) / totalReq) * 100) : 100;
  const bytesUp = stats?.metrics.bytes_up ?? 0;
  const bytesDown = stats?.metrics.bytes_down ?? 0;
  const latency = stats?.metrics.last_latency_ms ?? 0;
  const callsToday = stats?.scheduler.total_calls_today ?? 0;
  const quotaTotal = stats?.scheduler.total_daily_quota ?? 0;
  const quotaPct = quotaTotal ? Math.round((callsToday / quotaTotal) * 100) : 0;
  const downloads = stats?.downloads ?? [];
  const activeDownloads = downloads.filter((d) => d.status === "active").length;
  const hosts = stats?.metrics.hosts ?? [];

  async function toggle() {
    try {
      if (running) {
        await stop.mutateAsync();
        toast.success(t("toast.disconnected"));
      } else {
        await start.mutateAsync();
        toast.success(t("toast.connected"));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
      <ConnectionHero
        running={running}
        connecting={connecting}
        activeAccount={status?.active_account}
        lastError={status?.last_error}
        onToggle={toggle}
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={<Activity />}
          label={t("stat.requests")}
          value={totalReq.toLocaleString()}
          sub={`${totalErr} ${t("stat.errorsSuffix")}`}
          tone={totalErr === 0 ? "neutral" : totalErr / Math.max(1, totalReq) > 0.05 ? "danger" : "neutral"}
        />
        <StatTile
          icon={<Zap />}
          label={t("stat.latency")}
          value={latency > 0 ? Math.round(latency).toString() : "—"}
          unit={latency > 0 ? "ms" : undefined}
          sub={latency === 0 ? t("stat.noTraffic") : latency < 1500 ? t("stat.fast") : latency < 3000 ? t("stat.normal") : t("stat.slow")}
          tone={latency === 0 ? "neutral" : latency < 1500 ? "signal" : latency < 3000 ? "warn" : "danger"}
        />
        <StatTile
          icon={<ArrowDown />}
          label={t("stat.downloaded")}
          value={fmtBytes(bytesDown)}
          sub={
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3" />
              {fmtBytes(bytesUp)}
            </span>
          }
          tone="neutral"
        />
        <StatTile
          icon={<CheckCircle2 />}
          label={t("stat.success")}
          value={successPct.toString()}
          unit="%"
          sub={totalReq > 0 ? `${(totalReq - totalErr).toLocaleString()} ${t("stat.ok")}` : t("stat.noTraffic")}
          tone={totalReq === 0 ? "neutral" : successPct >= 95 ? "signal" : successPct >= 70 ? "warn" : "danger"}
        />
      </div>

      {/* Downloads panel */}
      {downloads.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line-subtle/70 px-5 py-3">
            <div className="flex items-center gap-2">
              <ArrowDown className="size-3.5 text-ink-2" />
              <span className="text-[13px] font-medium text-ink-1">{t("dl.title")}</span>
            </div>
            <Badge tone={activeDownloads > 0 ? "signal" : "muted"}>
              {activeDownloads} {t("dl.active")}
            </Badge>
          </div>
          <ul className="divide-y divide-line-subtle/60">
            {downloads.map((dl) => {
              const pct = dl.total_bytes > 0 ? Math.min(100, (dl.done_bytes / dl.total_bytes) * 100) : 0;
              return (
                <li key={dl.id} className="px-5 py-3">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="flex-1 truncate text-[13px] text-ink-1" title={dl.url}>
                      {dl.filename}
                    </span>
                    <span className="font-mono text-[11.5px] tabular-nums text-ink-3">
                      {fmtBytes(dl.done_bytes)} / {fmtBytes(dl.total_bytes)}
                    </span>
                    {dl.status === "active" && (
                      <button
                        onClick={async () => {
                          try {
                            await cancelDownload(dl.id);
                            toast.info(t("toast.dlCancelled"));
                          } catch (err) {
                            toast.error(String(err));
                          }
                        }}
                        className="rounded p-1 text-ink-3 hover:bg-bg-inset hover:text-ink-1"
                        aria-label={t("dl.cancel")}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                  <div className="relative h-1 overflow-hidden rounded-full bg-bg-inset">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 transition-[width] duration-500",
                        dl.status === "active" && "bg-signal",
                        dl.status === "done" && "bg-success",
                        dl.status === "failed" && "bg-danger",
                        dl.status === "cancelled" && "bg-ink-3",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-ink-3">
                    <span>{dl.done_chunks}/{dl.chunks} {t("dl.chunks")}</span>
                    <div className="flex items-center gap-3">
                      {dl.status === "active" && dl.bytes_per_sec > 0 && <span>{fmtBytesPerSec(dl.bytes_per_sec)}</span>}
                      {dl.status === "done" && <span className="text-success">{t("dl.complete")}</span>}
                      {dl.status === "failed" && <span className="text-danger">{dl.error || t("dl.failed")}</span>}
                      {dl.status === "cancelled" && <span>{t("dl.cancelled")}</span>}
                      <span className="tabular-nums">{Math.round(pct)}%</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Quota + Certificate */}
      <div className="grid gap-3 md:grid-cols-2">
        <QuotaCard
          pct={quotaPct}
          callsToday={callsToday}
          quotaTotal={quotaTotal}
          strategy={stats?.scheduler.strategy}
        />
        <CertCard
          trusted={!!status?.ca_trusted}
          httpAddr={status?.listen_address}
          socksAddr={status?.socks5_address}
        />
      </div>

      {/* Hosts table — dashboard merged */}
      <HostsTable hosts={hosts} />
    </div>
  );
}

function QuotaCard({
  pct, callsToday, quotaTotal, strategy,
}: {
  pct: number;
  callsToday: number;
  quotaTotal: number;
  strategy?: string;
}) {
  const t = useT();
  const tone = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "signal";
  const toneClass =
    tone === "danger" ? "text-danger stroke-danger"
    : tone === "warn" ? "text-warn stroke-warn"
    : "text-signal stroke-signal";

  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - Math.min(pct, 100) / 100);

  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="size-3.5 text-ink-3" />
          <span className="text-[13px] font-medium text-ink-1">{t("quota.title")}</span>
        </div>
        <Badge tone="muted">{strategy || "—"}</Badge>
      </div>

      <div className="mt-5 flex items-center gap-5">
        <div className="relative h-[124px] w-[124px] shrink-0">
          <svg viewBox="0 0 120 120" className="-rotate-90">
            <circle cx="60" cy="60" r="52" stroke="hsl(var(--line-subtle))" strokeWidth="6" fill="none" />
            <circle
              cx="60"
              cy="60"
              r="52"
              strokeWidth="6"
              fill="none"
              className={cn(toneClass, "transition-[stroke-dashoffset] duration-700")}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="display text-[42px] leading-none text-ink-1">{pct}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3 mt-1">
              {t("quota.usedSuffix")}
            </span>
          </div>
        </div>
        <dl className="flex-1 space-y-2.5 text-[13px]">
          <Row label={t("quota.callsToday")} value={callsToday.toLocaleString()} />
          <Row label={t("quota.dailyLimit")} value={quotaTotal.toLocaleString()} />
          <Row
            label={t("quota.remaining")}
            value={(quotaTotal - callsToday).toLocaleString()}
            valueClass={pct >= 90 ? "text-danger" : undefined}
          />
        </dl>
      </div>
    </Card>
  );
}

function CertCard({
  trusted, httpAddr, socksAddr,
}: {
  trusted: boolean;
  httpAddr?: string;
  socksAddr?: string;
}) {
  const t = useT();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        {trusted ? (
          <ShieldCheck className="size-3.5 text-success" />
        ) : (
          <ShieldOff className="size-3.5 text-danger" />
        )}
        <span className="text-[13px] font-medium text-ink-1">{t("homecert.title")}</span>
      </div>

      <div className="mt-5 flex items-start gap-4">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-xl border",
            trusted ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger",
          )}
        >
          {trusted ? <ShieldCheck className="size-6" /> : <ShieldOff className="size-6" />}
        </div>
        <div className="flex-1">
          <p className={cn("text-[14px] font-medium", trusted ? "text-success" : "text-danger")}>
            {trusted ? t("homecert.trusted") : t("homecert.notTrusted")}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3 leading-relaxed">
            {trusted ? t("homecert.trustedBody") : t("homecert.notTrustedBody")}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-2.5 text-[13px] border-t border-line-subtle/60 pt-4">
        <Row
          label={
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-3" /> {t("homecert.httpProxy")}
            </span>
          }
          value={<span className="font-mono text-[12px]">{httpAddr || "—"}</span>}
        />
        <Row
          label={
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-3" /> {t("homecert.socks5")}
            </span>
          }
          value={<span className="font-mono text-[12px]">{socksAddr || t("homecert.off")}</span>}
        />
      </div>
    </Card>
  );
}

function Row({
  label, value, valueClass,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-3 text-[12.5px]">{label}</dt>
      <dd className={cn("font-mono text-[13px] tabular-nums text-ink-1", valueClass)}>{value}</dd>
    </div>
  );
}
