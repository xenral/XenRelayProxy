import { Check, Cloud, Wand2 } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useWizard } from "../_context";

export function Mode() {
  const t = useT();
  const { mode, setMode } = useWizard();

  const cards = [
    {
      id: "apps_script" as const,
      icon: Wand2,
      title: t("wizard.mode.apps.title"),
      body: t("wizard.mode.apps.body"),
      bullets: [
        t("wizard.mode.apps.b1"),
        t("wizard.mode.apps.b2"),
        t("wizard.mode.apps.b3"),
      ],
    },
    {
      id: "vercel" as const,
      icon: Cloud,
      title: t("wizard.mode.vercel.title"),
      body: t("wizard.mode.vercel.body"),
      bullets: [
        t("wizard.mode.vercel.b1"),
        t("wizard.mode.vercel.b2"),
        t("wizard.mode.vercel.b3"),
      ],
    },
  ];

  return (
    <Card className="p-7">
      <div className="flex items-center gap-2">
        <Cloud className="size-4 text-ink-3" />
        <h2 className="text-[16px] font-medium text-ink-1">{t("wizard.mode.title")}</h2>
      </div>
      <p className="mt-1.5 text-[13.5px] text-ink-2 leading-relaxed max-w-xl">{t("wizard.mode.body")}</p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {cards.map(({ id, icon: Icon, title, body, bullets }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "group relative flex flex-col gap-3 rounded-xl border bg-bg-inset/50 p-5 text-left transition-all",
                active
                  ? "border-signal/60 bg-signal/5 shadow-[0_0_0_1px_hsl(var(--signal)/0.4),0_0_30px_-8px_hsl(var(--signal)/0.4)]"
                  : "border-line-subtle hover:border-line-strong hover:bg-bg-inset",
              )}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
                    active
                      ? "border-signal/50 bg-signal/15 text-signal"
                      : "border-line-strong bg-bg-overlay text-ink-2 group-hover:text-ink-1",
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <strong className="flex-1 text-[14px] text-ink-1">{title}</strong>
                {active && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal text-signal-ink">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
              </div>
              <p className="text-[12.5px] text-ink-2 leading-relaxed">{body}</p>
              <ul className="mt-1 space-y-1.5">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-[12px] text-ink-2"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1 w-1 shrink-0 rounded-full",
                        active ? "bg-signal" : "bg-ink-3",
                      )}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-[12px] text-ink-3 leading-relaxed">{t("wizard.mode.switchHint")}</p>
    </Card>
  );
}
