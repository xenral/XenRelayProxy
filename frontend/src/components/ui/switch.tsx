import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[20px] w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong transition-colors duration-200",
      "data-[state=checked]:bg-signal data-[state=checked]:border-signal/60",
      "data-[state=unchecked]:bg-bg-inset",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-3.5 w-3.5 rounded-full shadow-sm transition-transform duration-200",
        "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-signal-ink",
        "data-[state=unchecked]:translate-x-[2px] data-[state=unchecked]:bg-ink-2",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
