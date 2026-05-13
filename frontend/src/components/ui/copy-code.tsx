import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyCodeProps {
  code: string;
  label?: string;
  className?: string;
  language?: string;
}

export function CopyCode({ code, label, className, language }: CopyCodeProps) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border border-line-subtle bg-bg-inset",
        className,
      )}
    >
      {(label || language) && (
        <div className="flex items-center justify-between border-b border-line-subtle/70 px-3 py-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
            {label ?? language}
          </span>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink-1 hover:bg-bg-overlay transition-colors"
          >
            {copied ? <Check className="size-3 text-signal" /> : <Copy className="size-3" />}
            <span className="font-mono uppercase tracking-wider">
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed font-mono text-ink-1">
        <code>{code}</code>
      </pre>
      {!label && !language && (
        <button
          type="button"
          onClick={copy}
          className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-bg-overlay px-2 py-1 text-[11px] text-ink-2 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink-1"
        >
          {copied ? <Check className="size-3 text-signal" /> : <Copy className="size-3" />}
        </button>
      )}
    </div>
  );
}
