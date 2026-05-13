import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-full border border-line-subtle bg-bg-raised/70 p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-medium tracking-tight transition-all duration-150",
      "text-ink-2 hover:text-ink-1",
      "data-[state=active]:bg-bg-inset data-[state=active]:text-ink-1 data-[state=active]:shadow-[inset_0_0_0_1px_hsl(var(--line-strong))]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/55",
      "disabled:pointer-events-none disabled:opacity-50",
      "[&_svg]:size-3.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-5 focus-visible:outline-none data-[state=active]:animate-fade-in",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
