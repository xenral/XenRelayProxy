import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { RAIL } from "./_utils";

interface Props {
  current: number;
  furthest: number;
  onJump: (i: number) => void;
}

export function StepRail({ current, furthest, onJump }: Props) {
  const t = useT();
  return (
    <aside className="w-full md:w-[220px] shrink-0">
      <div className="label-kicker mb-4">{t("wizard.rail.title")}</div>
      <ol className="space-y-1.5">
        {RAIL.map(({ id, labelKey, icon: Icon }, i) => {
          const visited = i <= furthest;
          const active = i === current;
          const done = i < furthest;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => visited && onJump(i)}
                disabled={!visited}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                  active
                    ? "bg-signal/10 text-ink-1"
                    : visited
                      ? "text-ink-2 hover:bg-bg-inset hover:text-ink-1"
                      : "text-ink-3/60 cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] tabular-nums transition-colors",
                    active
                      ? "border-signal bg-signal text-signal-ink shadow-[0_0_12px_-2px_hsl(var(--signal)/0.5)]"
                      : done
                        ? "border-signal/40 bg-signal/10 text-signal"
                        : "border-line-subtle bg-bg-inset text-ink-3",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <Icon
                  className={cn(
                    "size-3.5 shrink-0 transition-colors",
                    active ? "text-signal" : done ? "text-signal/70" : "text-ink-3",
                  )}
                />
                <span className="flex-1 truncate text-[12.5px] font-medium tracking-tight">
                  {t(labelKey)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
