import { Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

interface Props {
  state: "connected" | "connecting" | "disconnected";
  address?: string;
  className?: string;
}

export function StatusPill({ state, address, className }: Props) {
  const t = useT();
  const labelKey =
    state === "connected" ? "status.connected"
    : state === "connecting" ? "status.connecting"
    : "status.disconnected";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border bg-bg-raised/70 px-3 py-1.5 backdrop-blur-sm",
        state === "connected" && "border-signal/45 shadow-[0_0_24px_-8px_hsl(var(--signal)/0.55)]",
        state === "connecting" && "border-warn/45",
        state === "disconnected" && "border-line-strong",
        className,
      )}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        {state === "connected" && (
          <>
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-signal" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
          </>
        )}
        {state === "connecting" && (
          <Loader2 className="size-3 animate-spin text-warn" />
        )}
        {state === "disconnected" && (
          <span className="inline-flex h-2 w-2 rounded-full bg-ink-3" />
        )}
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-1">
        {t(labelKey)}
      </span>
      {address && state === "connected" && (
        <span className="border-l border-line-subtle pl-2.5 font-mono text-[10.5px] tabular-nums text-ink-3">
          {address}
        </span>
      )}
    </div>
  );
}
