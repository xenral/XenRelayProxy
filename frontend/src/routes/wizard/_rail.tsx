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
      <div className="label-kicker mb-3 md:mb-4">{t("wizard.rail.title")}</div>
      {/* Horizontal scroll strip on mobile, vertical list on md+ */}
      <ol className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-col md:gap-1.5 md:space-y-0 md:overflow-visible md:pb-0">
        {RAIL.map(({ id, labelKey, icon: Icon }, i) => {
          const visited = i <= furthest;
          const active = i === current;
          const done = i < furthest;
          return (
            <li key={id} className="shrink-0 md:shrink">
              <button
                type="button"
                onClick={() => visited && onJump(i)}
                disabled={!visited}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left transition-colors md:gap-3 md:rounded-lg md:px-2.5 md:py-2",
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
                    "hidden size-3.5 shrink-0 transition-colors md:inline",
                    active ? "text-signal" : done ? "text-signal/70" : "text-ink-3",
                  )}
                />
                <span className="truncate text-[12px] font-medium tracking-tight md:flex-1 md:text-[12.5px]">
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
