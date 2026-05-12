import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "signal" | "warn" | "danger" | "neutral";

interface Props {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone: Tone;
}

const TONE_ICON: Record<Tone, string> = {
  signal: "bg-signal/12 text-signal border-signal/30",
  warn: "bg-warn/12 text-warn border-warn/30",
  danger: "bg-danger/12 text-danger border-danger/30",
  neutral: "bg-bg-inset text-ink-2 border-line-strong",
};

const TONE_VALUE: Record<Tone, string> = {
  signal: "text-ink-1",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-ink-1",
};

export function StatTile({ icon, label, value, unit, sub, tone }: Props) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <span className="label-kicker">{label}</span>
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md border [&_svg]:size-3.5",
            TONE_ICON[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("display text-[40px] leading-none tracking-tightest", TONE_VALUE[tone])}>
          {value}
        </span>
        {unit && (
          <span className="font-mono text-[12px] uppercase tracking-wider text-ink-3">{unit}</span>
        )}
      </div>
      {sub && (
        <div className="font-mono text-[11px] text-ink-3 tabular-nums">{sub}</div>
      )}
    </Card>
  );
}
