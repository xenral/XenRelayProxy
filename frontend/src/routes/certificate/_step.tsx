import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StepProps {
  num: number | string;
  warn?: boolean;
  title: string;
  children: ReactNode;
}

export function Step({ num, warn, title, children }: StepProps) {
  return (
    <Card className="p-5">
      <div className="flex gap-4">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[12px]",
            warn
              ? "border-warn/40 bg-warn/10 text-warn"
              : "border-line-strong bg-bg-inset text-ink-2",
          )}
        >
          {num}
        </div>
        <div className="flex-1 space-y-2">
          <h3 className="text-[14px] font-medium text-ink-1">{title}</h3>
          <div className="text-[13px] text-ink-2 leading-relaxed space-y-2">{children}</div>
        </div>
      </div>
    </Card>
  );
}

export function StepList({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}
