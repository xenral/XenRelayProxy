import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-mono uppercase tracking-[0.14em] whitespace-nowrap",
  {
    variants: {
      tone: {
        signal:
          "bg-signal/15 text-signal border border-signal/30",
        success:
          "bg-success/12 text-success border border-success/30",
        warn: "bg-warn/12 text-warn border border-warn/30",
        danger: "bg-danger/12 text-danger border border-danger/30",
        info: "bg-info/12 text-info border border-info/30",
        muted:
          "bg-bg-inset text-ink-3 border border-line-subtle",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
