import { useLocation } from "react-router-dom";
import { Loader2, Menu, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { useUI } from "@/stores/ui";
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
  const toggleMobileNav = useUI((s) => s.toggleMobileNav);

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
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line-subtle bg-bg-base/70 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4 md:px-7">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Mobile menu button */}
        <button
          onClick={toggleMobileNav}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-subtle bg-bg-raised/60 text-ink-2 hover:bg-bg-inset hover:text-ink-1 transition-colors lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 sm:gap-3">
            <h1 className="display truncate text-[22px] leading-none tracking-tightest text-ink-1 sm:text-[26px] md:text-[32px]">
              {t(titleKey)}
            </h1>
            <span className="ribbon hidden sm:inline">
              {location.pathname === "/" ? "console" : location.pathname.slice(1)}
            </span>
          </div>
          <p className="mt-1 truncate text-[12px] text-ink-3 sm:text-[13px]">
            {running ? status?.listen_address : t("header.notRunning")}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="hidden sm:block">
          <StatusPill state={state} address={status?.listen_address} />
        </div>
        <Button
          variant={running ? "danger" : "primary"}
          size="lg"
          disabled={connecting}
          onClick={toggle}
          className={cn(
            "min-w-[44px] sm:min-w-[140px]",
            running && "bg-danger/15 text-danger border-danger/40 hover:bg-danger/25",
          )}
        >
          {connecting ? (
            <Loader2 className="animate-spin-fast" />
          ) : running ? (
            <Square />
          ) : (
            <Play />
          )}
          <span className="hidden sm:inline">
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
