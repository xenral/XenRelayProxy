import { useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { generateAuthKey } from "@/lib/api";
import { useWizard } from "../_context";
import { isPlaceholderKey } from "../_utils";

export function Auth() {
  const t = useT();
  const { mode, authKey, setAuthKey, frontDomain, setFrontDomain } = useWizard();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const placeholder = isPlaceholderKey(authKey);

  async function regen() {
    setBusy(true);
    try {
      setAuthKey(await generateAuthKey());
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(authKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <Card className="p-7 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-ink-3" />
          <h2 className="text-[16px] font-medium text-ink-1">{t("wizard.auth.title")}</h2>
        </div>
        <p className="mt-1.5 text-[13.5px] text-ink-2 leading-relaxed max-w-2xl">{t("wizard.auth.body")}</p>
      </div>

      <div>
        <Label>{t("wizard.auth.keyLabel")}</Label>
        <div className="mt-2 flex gap-2">
          <Input
            className={cn(
              "font-mono text-[12.5px]",
              placeholder && "border-danger/60 focus-visible:ring-danger/55 focus-visible:border-danger/60",
            )}
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            spellCheck={false}
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={regen}
            disabled={busy}
            title={t("wizard.auth.regenerate")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={copy}
            title={t("wizard.auth.copy")}
          >
            {copied ? <Check className="text-signal" /> : <Copy />}
          </Button>
        </div>
        {placeholder ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-danger font-mono">
            <AlertTriangle className="size-3" /> {t("wizard.auth.placeholderError")}
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-ink-3 leading-relaxed">
            {mode === "vercel" ? t("wizard.auth.helpVercel") : t("wizard.auth.help")}
          </p>
        )}
      </div>

      {mode === "apps_script" && (
        <div>
          <Label>{t("wizard.auth.frontDomainLabel")}</Label>
          <Input
            className="mt-2 font-mono text-[12.5px]"
            value={frontDomain}
            onChange={(e) => setFrontDomain(e.target.value)}
            spellCheck={false}
            placeholder="www.google.com"
          />
          <p className="mt-2 text-[12px] text-ink-3 leading-relaxed">{t("wizard.auth.frontDomainHelp")}</p>
        </div>
      )}
    </Card>
  );
}
