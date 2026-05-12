import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { installCA, isCATrusted } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Cert() {
  const t = useT();
  const [trusted, setTrusted] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    isCATrusted().then((v) => { if (!cancelled) setTrusted(!!v); }).catch(() => {});
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  async function install() {
    setInstalling(true); setErr(null);
    try {
      await installCA();
      const start = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const v = await isCATrusted();
          if (v) {
            setTrusted(true);
            setInstalling(false);
            if (pollRef.current) window.clearInterval(pollRef.current);
          } else if (Date.now() - start > 30000) {
            setInstalling(false);
            if (pollRef.current) window.clearInterval(pollRef.current);
          }
        } catch {}
      }, 1500);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  }

  const state: "ok" | "warn" | "off" = trusted ? "ok" : installing ? "warn" : "off";
  const stateClass =
    state === "ok"
      ? "border-success/40 bg-success/5"
      : state === "warn"
        ? "border-warn/40 bg-warn/5"
        : "border-danger/40 bg-danger/5";

  return (
    <Card className="p-7 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-ink-3" />
          <h2 className="text-[16px] font-medium text-ink-1">{t("wizard.cert.title")}</h2>
        </div>
        <p className="mt-1.5 text-[13.5px] text-ink-2 leading-relaxed max-w-2xl">{t("wizard.cert.body")}</p>
      </div>

      <div className={cn("flex items-center gap-4 rounded-lg border p-5", stateClass)}>
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-md",
            state === "ok"
              ? "bg-success/15 text-success"
              : state === "warn"
                ? "bg-warn/15 text-warn"
                : "bg-danger/15 text-danger",
          )}
        >
          {installing ? (
            <Loader2 className="size-6 animate-spin" />
          ) : trusted ? (
            <ShieldCheck className="size-6" />
          ) : (
            <ShieldOff className="size-6" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <strong className="block text-[13.5px] font-medium text-ink-1">
            {installing
              ? t("wizard.cert.installing")
              : trusted
                ? t("wizard.cert.trusted")
                : t("wizard.cert.notTrusted")}
          </strong>
          <p className="mt-1 text-[12.5px] text-ink-2 leading-relaxed">
            {trusted ? t("wizard.cert.trustedBody") : t("wizard.cert.notTrustedBody")}
          </p>
        </div>
        {!trusted && (
          <Button
            type="button"
            variant="primary"
            onClick={install}
            disabled={installing}
            className="shrink-0"
          >
            {installing ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {installing ? t("wizard.cert.installing") : t("wizard.cert.install")}
          </Button>
        )}
      </div>

      {err && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-danger font-mono">
          <AlertTriangle className="size-3" /> {err}
        </p>
      )}

      <p className="text-[12px] text-ink-3 leading-relaxed">{t("wizard.cert.skipNote")}</p>
    </Card>
  );
}
