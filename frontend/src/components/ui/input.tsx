import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-line-strong bg-bg-inset px-3.5 py-1.5 text-[13px] text-ink-1",
        "placeholder:text-ink-3 placeholder:font-normal",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/55 focus-visible:border-signal/60",
        "transition-[border,box-shadow] duration-150",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "[&[type=number]]:font-mono [&[type=number]]:tabular-nums",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-line-strong bg-bg-inset px-3.5 py-2 text-[13px] text-ink-1 leading-relaxed",
        "placeholder:text-ink-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/55 focus-visible:border-signal/60",
        "transition-[border,box-shadow] duration-150",
        "resize-y",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-[11px] font-mono uppercase tracking-[0.14em] text-ink-3 select-none",
        className,
      )}
      {...p}
    />
  );
}

export function FieldHint({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[12px] leading-relaxed text-ink-3 mt-1.5", className)} {...p} />;
}

export function FieldError({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-[12px] text-danger font-mono mt-1.5", className)}
      {...p}
    />
  );
}
