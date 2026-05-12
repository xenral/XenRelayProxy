import { useState } from "react";
import { Check, Loader2, Rocket } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWizard } from "../_context";
import { maskKey } from "../_utils";

interface Props {
  onStart: () => Promise<void>;
}

export function Done({ onStart }: Props) {
  const t = useT();
  const { mode, authKey, accLabel, scriptIDs, googleIP, vercelURL } = useWizard();
  const [starting, setStarting] = useState(false);

  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    {
      label: t("wizard.done.summaryMode"),
      value: mode === "vercel" ? t("wizard.mode.vercel.title") : t("wizard.mode.apps.title"),
    },
    {
      label: t("wizard.done.summaryAuthKey"),
      value: maskKey(authKey),
      mono: true,
    },
  ];
  if (mode === "vercel") {
    rows.push({
      label: t("wizard.done.summaryVercelURL"),
      value: vercelURL || "—",
      mono: true,
    });
  } else {
    rows.push({
      label: t("wizard.done.summaryAccount"),
      value: `${accLabel} · ${scriptIDs.length} ${t("wizard.done.summaryDeployments")}`,
    });
    rows.push({
      label: t("wizard.done.summaryFrontIP"),
      value: googleIP,
      mono: true,
    });
  }

  return (
    <Card className="p-9 text-center">
      <div className="flex justify-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-success/40 bg-success/10 shadow-[0_0_40px_-8px_hsl(var(--success)/0.5)]">
          <Check className="size-7 text-success" strokeWidth={2.5} />
        </div>
      </div>

      <h1 className="display mt-7 text-[40px] leading-[1.05] tracking-tightest text-ink-1">
        {t("wizard.done.title")}
      </h1>
      <p className="mt-3 text-[14px] text-ink-2 leading-relaxed max-w-xl mx-auto">
        {t("wizard.done.body")}
      </p>

      <dl className="mt-7 max-w-md mx-auto divide-y divide-line-subtle/60 rounded-lg border border-line-subtle bg-bg-inset/50 text-left">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-[11.5px] font-mono uppercase tracking-[0.14em] text-ink-3">
              {r.label}
            </dt>
            <dd
              className={
                r.mono
                  ? "font-mono text-[12px] text-ink-1 tabular-nums truncate"
                  : "text-[12.5px] text-ink-1 truncate"
              }
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex justify-center">
        <Button
          variant="primary"
          size="lg"
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            try {
              await onStart();
            } finally {
              setStarting(false);
            }
          }}
        >
          {starting ? <Loader2 className="animate-spin" /> : <Rocket />}
          {starting ? t("wizard.done.starting") : t("wizard.done.start")}
        </Button>
      </div>
    </Card>
  );
}
