import { ArrowRight, KeyRound, Rocket, ShieldCheck, Wand2 } from "lucide-react";
import { useT, type Locale } from "@/i18n";
import { useUI } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ROADMAP = [
  { key: "wizard.welcome.r1", icon: KeyRound },
  { key: "wizard.welcome.r2", icon: Wand2 },
  { key: "wizard.welcome.r3", icon: ShieldCheck },
  { key: "wizard.welcome.r4", icon: Rocket },
];

export function Welcome({ onNext }: { onNext: () => void }) {
  const t = useT();
  const locale = useUI((s) => s.locale);
  const setLocale = useUI((s) => s.setLocale);

  return (
    <Card className="overflow-hidden p-5 sm:p-7 md:p-9">
      <div className="flex justify-center">
        <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-signal/40 bg-bg-inset shadow-[0_0_40px_-8px_hsl(var(--signal)/0.5)] sm:h-16 sm:w-16">
          <img
            src="/logo.png"
            alt="XenRelayProxy"
            className="h-full w-full object-cover"
            draggable={false}
          />
          <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-signal shadow-[0_0_12px_hsl(var(--signal))] animate-pulse-ring" />
        </div>
      </div>

      <h1 className="display text-center mt-6 text-[28px] leading-[1.05] tracking-tightest text-ink-1 sm:mt-7 sm:text-[36px] md:text-[44px]">
        {t("wizard.welcome.title")}
      </h1>
      <p className="mt-3 text-center text-[13px] text-ink-2 leading-relaxed max-w-xl mx-auto sm:text-[14px]">
        {t("wizard.welcome.body")}
      </p>

      <ol className="mt-8 grid gap-2 sm:grid-cols-2 max-w-xl mx-auto">
        {ROADMAP.map(({ key, icon: Icon }, i) => (
          <li
            key={key}
            className="flex items-center gap-3 rounded-md border border-line-subtle bg-bg-inset/60 px-3 py-2.5"
          >
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3 tabular-nums">
              0{i + 1}
            </span>
            <Icon className="size-3.5 text-ink-3" />
            <span className="text-[12.5px] text-ink-1">{t(key)}</span>
          </li>
        ))}
      </ol>

      <div className="mt-7 flex flex-col items-stretch gap-4 sm:mt-9 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="label-kicker">{t("wizard.welcome.lang")}</span>
          <div className="flex rounded-full border border-line-strong overflow-hidden">
            {(["en", "fa"] as Locale[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={cn(
                  "px-3 py-1 text-[12px] transition-colors",
                  locale === l
                    ? "bg-signal text-signal-ink font-medium"
                    : "text-ink-2 hover:bg-bg-inset hover:text-ink-1",
                )}
              >
                {l === "en" ? "English" : "فارسی"}
              </button>
            ))}
          </div>
        </div>

        <Button variant="primary" size="lg" onClick={onNext} className="w-full sm:w-auto">
          {t("wizard.welcome.cta")}
          <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}
