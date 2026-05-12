import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium tracking-tight transition-[background,color,box-shadow,transform] duration-150 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-signal text-signal-ink hover:bg-signal/90 active:translate-y-[1px] shadow-[0_1px_0_hsl(0_0%_0%/0.4)_inset,0_8px_24px_-12px_hsl(var(--signal)/0.6)]",
        secondary:
          "bg-bg-overlay text-ink-1 border border-line-strong hover:border-ink-3 hover:bg-bg-inset",
        ghost:
          "bg-transparent text-ink-2 hover:text-ink-1 hover:bg-bg-inset",
        outline:
          "border border-line-strong text-ink-1 bg-transparent hover:bg-bg-inset",
        danger:
          "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
        link: "text-signal underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-9 px-3.5",
        lg: "h-11 px-5 text-[14px]",
        icon: "h-9 w-9",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
