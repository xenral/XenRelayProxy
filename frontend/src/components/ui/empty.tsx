import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong bg-bg-raised/40 px-8 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div className="rounded-full border border-line-strong bg-bg-inset p-3 text-ink-3">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-ink-1">{title}</p>
        {description && <p className="text-[12.5px] text-ink-3 max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
