import { useLocation } from "react-router-dom";
import { Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { StatusPill } from "./StatusPill";
import { useStatus, useStartRelay, useStopRelay } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TITLE_BY_PATH: Record<string, string> = {
  "/": "nav.home",
  "/accounts": "nav.accounts",
  "/logs": "nav.logs",
  "/settings": "nav.settings",
  "/certificate": "nav.cert",
  "/terminal": "nav.terminal",
  "/wizard": "nav.wizard",
  "/python-relay": "nav.pythonRelayGuide",
  "/vercel-relay": "nav.vercelRelayGuide",
  "/about": "nav.about",
};

export function TopBar() {
  const t = useT();
  const location = useLocation();
  const { data: status } = useStatus();
  const start = useStartRelay();
  const stop = useStopRelay();

  const running = !!status?.running;
  const connecting = start.isPending || stop.isPending;

  const state: "connected" | "connecting" | "disconnected" = connecting
    ? "connecting"
    : running
      ? "connected"
      : "disconnected";

  const titleKey = TITLE_BY_PATH[location.pathname] ?? "nav.home";

  async function toggle() {
    try {
      if (running) {
        await stop.mutateAsync();
        toast.success(t("toast.disconnected"));
      } else {
        await start.mutateAsync();
        toast.success(t("toast.connected"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-line-subtle bg-bg-base/70 px-7 py-4 backdrop-blur-md">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <h1 className="display text-[34px] leading-none tracking-tightest text-ink-1">
            {t(titleKey)}
          </h1>
          <span className="ribbon">{location.pathname === "/" ? "console" : location.pathname.slice(1)}</span>
        </div>
        <p className="mt-1 text-[13px] text-ink-3">
          {running ? status?.listen_address : t("header.notRunning")}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <StatusPill state={state} address={status?.listen_address} />
        <Button
          variant={running ? "danger" : "primary"}
          size="lg"
          disabled={connecting}
          onClick={toggle}
          className={cn(
            "min-w-[148px]",
            running && "bg-danger/15 text-danger border-danger/40 hover:bg-danger/25",
          )}
        >
          {connecting ? (
            <Loader2 className="animate-spin" />
          ) : running ? (
            <Square />
          ) : (
            <Play />
          )}
          <span>
            {connecting
              ? t("btn.connecting")
              : running
                ? t("btn.disconnect")
                : t("btn.connect")}
          </span>
        </Button>
      </div>
    </header>
  );
}
