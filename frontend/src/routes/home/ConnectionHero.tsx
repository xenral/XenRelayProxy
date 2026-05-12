import { useEffect, useState } from "react";
import {
  AlertTriangle, Clock, Globe2, Loader2, Play, Server, Square, Wifi, WifiOff, Zap,
} from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { fmtUptime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  running: boolean;
  connecting: boolean;
  activeAccount?: string;
  lastError?: string;
  onToggle: () => void;
}

export function ConnectionHero({ running, connecting, activeAccount, lastError, onToggle }: Props) {
  const t = useT();
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    if (!running) {
      setUptime(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const state = connecting ? "connecting" : running ? "on" : "off";

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-line-subtle bg-bg-raised p-7",
        running && "border-signal/30",
      )}
    >
      {/* Atmosphere */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-700",
          running ? "opacity-100" : "opacity-40",
        )}
        aria-hidden
      >
        <div
          className="absolute -top-20 -left-20 h-96 w-96 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              state === "on"
                ? "radial-gradient(circle, hsl(var(--signal) / 0.45), transparent 70%)"
                : state === "connecting"
                  ? "radial-gradient(circle, hsl(var(--warn) / 0.35), transparent 70%)"
                  : "radial-gradient(circle, hsl(var(--info) / 0.2), transparent 70%)",
          }}
        />
        <div className="absolute inset-0 bg-grid bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_80%)] opacity-40" />
      </div>

      <div className="relative flex items-center gap-8">
        {/* Orb */}
        <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
          {state === "on" && (
            <>
              <span
                className="absolute inset-0 rounded-full animate-pulse-ring"
                style={{ animationDuration: "2.6s" }}
              />
              <span
                className="absolute inset-0 rounded-full animate-pulse-ring"
                style={{ animationDuration: "2.6s", animationDelay: "1.3s" }}
              />
            </>
          )}
          <div
            className={cn(
              "relative flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all duration-500",
              state === "on" && "border-signal/60 bg-signal/15 text-signal shadow-[0_0_60px_-10px_hsl(var(--signal)/0.7)]",
              state === "connecting" && "border-warn/60 bg-warn/10 text-warn",
              state === "off" && "border-line-strong bg-bg-inset text-ink-3",
            )}
          >
            {connecting ? (
              <Loader2 className="size-10 animate-spin" />
            ) : running ? (
              <Wifi className="size-10" />
            ) : (
              <WifiOff className="size-10" />
            )}
          </div>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-3 mb-2">
            {running ? "tunnel" : "ready"}
          </div>
          <h2 className="display text-[52px] leading-none tracking-tightest text-ink-1">
            {connecting
              ? t("status.connecting")
              : running
                ? t("status.connected")
                : t("status.disconnected")}
          </h2>
          <p className="mt-3 flex items-center gap-2.5 text-[13.5px] text-ink-2">
            {connecting && (
              <>
                <Loader2 className="size-3 animate-spin" />
                <span>{t("hero.establishing")}</span>
              </>
            )}
            {!connecting && running && (
              <>
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{t("hero.via")}</span>
                <span className="font-mono text-ink-1">{activeAccount || "primary"}</span>
                <span className="text-ink-3">·</span>
                <Clock className="size-3 text-ink-3" />
                <span className="font-mono tabular-nums text-ink-1">{fmtUptime(uptime)}</span>
              </>
            )}
            {!connecting && !running && <span>{t("hero.tapConnect")}</span>}
          </p>
        </div>

        {/* Big toggle */}
        <Button
          variant={running ? "secondary" : "primary"}
          size="lg"
          disabled={connecting}
          onClick={onToggle}
          className={cn("h-14 min-w-[164px] text-[14px]", running && "border-danger/40 text-danger hover:bg-danger/15")}
        >
          {connecting ? <Loader2 className="animate-spin" /> : running ? <Square /> : <Play />}
          <span className="ml-1">
            {connecting ? t("btn.pleaseWait") : running ? t("btn.disconnect") : t("btn.connect")}
          </span>
        </Button>
      </div>

      {lastError && (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2.5 text-[12.5px] text-danger animate-slide-up">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span className="leading-relaxed">{lastError}</span>
        </div>
      )}

      {running && (
        <div className="relative mt-6 flex items-center gap-2 overflow-x-auto pb-1">
          <RouteNode icon={<Globe2 />} label={t("hero.routeBrowser")} />
          <RouteArrow />
          <RouteNode icon={<Server />} label={t("hero.routeProxy")} />
          <RouteArrow />
          <RouteNode icon={<Zap />} label={t("hero.routeAppsScript")} highlight />
          <RouteArrow />
          <RouteNode icon={<Globe2 />} label={t("hero.routeTarget")} />
        </div>
      )}
    </section>
  );
}

function RouteNode({
  icon, label, highlight,
}: { icon: React.ReactNode; label: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider",
        highlight
          ? "border-signal/40 bg-signal/10 text-signal"
          : "border-line-subtle bg-bg-inset/60 text-ink-2",
      )}
    >
      <span className="[&_svg]:size-3 shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function RouteArrow() {
  return (
    <span className="shrink-0 text-ink-3 font-mono text-[14px] leading-none">→</span>
  );
}
