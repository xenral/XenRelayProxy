import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

interface Props extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  tone?: "signal" | "warn" | "danger" | "info";
}

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  Props
>(({ className, value, tone = "signal", ...props }, ref) => {
  const toneCls =
    tone === "danger" ? "bg-danger"
    : tone === "warn" ? "bg-warn"
    : tone === "info" ? "bg-info"
    : "bg-signal";
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-bg-inset", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 transition-transform duration-300", toneCls)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";
