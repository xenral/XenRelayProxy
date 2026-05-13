import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ExternalLink, Loader2, Wand2, Wifi, X,
} from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyCode } from "@/components/ui/copy-code";
import { getCodeGS, scanFrontIPs } from "@/lib/api";
import type { ScanResult } from "@/types/domain";
import { cn } from "@/lib/utils";
import { useWizard } from "../_context";

export function AppsScriptAccount() {
  const t = useT();
  const {
    authKey,
    accLabel, setAccLabel,
    accEmail, setAccEmail,
    scriptIDs, setScriptIDs,
    scriptDraft, setScriptDraft,
    dailyQuota, setDailyQuota,
    googleIP, setGoogleIP,
  } = useWizard();

  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanErr, setScanErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCodeGS().then((c) => { if (!cancelled) setCode(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function addChip() {
    const v = scriptDraft.trim();
    if (!v) return;
    if (scriptIDs.includes(v)) { setScriptDraft(""); return; }
    setScriptIDs([...scriptIDs, v]);
    setScriptDraft("");
  }

  function removeChip(s: string) {
    setScriptIDs(scriptIDs.filter((x) => x !== s));
  }

  async function runScan() {
    setScanning(true); setScanErr(null); setScanResults([]);
    try {
      const r = await scanFrontIPs();
      setScanResults(r);
      const best = r.find((x) => x.recommend) || r.find((x) => x.ok);
      if (best) setGoogleIP(best.ip);
    } catch (err: unknown) {
      setScanErr(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  const personalisedSnippet = useMemo(
    () => `const AUTH_KEY = "${authKey || "<your auth key>"}";`,
    [authKey],
  );

  return (
    <div className="space-y-4">
      <Card className="p-7 space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-ink-3" />
            <h2 className="text-[16px] font-medium text-ink-1">{t("wizard.account.title")}</h2>
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-2 leading-relaxed max-w-2xl">{t("wizard.account.body")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("wizard.account.label")}</Label>
            <Input
              className="mt-2"
              value={accLabel}
              onChange={(e) => setAccLabel(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("wizard.account.email")}</Label>
            <Input
              className="mt-2"
              type="email"
              value={accEmail}
              onChange={(e) => setAccEmail(e.target.value)}
              placeholder="you@gmail.com"
            />
          </div>
        </div>

        <div>
          <Label>{t("wizard.account.scriptIds")}</Label>
          <div className="mt-2 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-bg-inset px-2 py-1.5 focus-within:ring-2 focus-within:ring-signal/55 focus-within:border-signal/60">
            {scriptIDs.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded border border-line-subtle bg-bg-overlay px-1.5 py-0.5 font-mono text-[11.5px] text-ink-1"
              >
                {s.length > 24 ? s.slice(0, 18) + "…" + s.slice(-4) : s}
                <button
                  type="button"
                  onClick={() => removeChip(s)}
                  className="text-ink-3 hover:text-danger transition-colors"
                  aria-label="remove"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              className="flex-1 min-w-[140px] bg-transparent text-[12.5px] text-ink-1 placeholder:text-ink-3 font-mono outline-none"
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault(); addChip();
                } else if (e.key === "Backspace" && !scriptDraft && scriptIDs.length > 0) {
                  setScriptIDs(scriptIDs.slice(0, -1));
                }
              }}
              onBlur={addChip}
              placeholder={t("wizard.account.scriptIdsPlaceholder")}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("wizard.account.quota")}</Label>
            <Input
              className="mt-2"
              type="number"
              value={dailyQuota}
              onChange={(e) => setDailyQuota(parseInt(e.target.value || "0", 10) || 20000)}
            />
          </div>
          <div>
            <Label>{t("wizard.account.googleIP")}</Label>
            <Input
              className="mt-2 font-mono"
              value={googleIP}
              onChange={(e) => setGoogleIP(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="p-7 space-y-4">
        <div>
          <span className="label-kicker">{t("wizard.codegs.title")}</span>
          <p className="mt-1.5 text-[12.5px] text-ink-3 leading-relaxed max-w-2xl">{t("wizard.codegs.body")}</p>
        </div>

        <ol className="space-y-3 text-[12.5px] text-ink-2">
          <Step n={1}>
            <span>{t("wizard.codegs.step1")} </span>
            <a
              className="inline-flex items-center gap-1 text-signal hover:underline"
              href="https://script.google.com"
              target="_blank"
              rel="noreferrer"
            >
              script.google.com <ExternalLink className="size-3" />
            </a>
          </Step>
          <Step n={2}>{t("wizard.codegs.step2")}</Step>
          <Step n={3}>{t("wizard.codegs.step3")}</Step>
          <Step n={4}>
            <span>{t("wizard.codegs.step4")}</span>
            <div className="mt-2">
              <CopyCode label="snippet" code={personalisedSnippet} />
            </div>
          </Step>
          <Step n={5}>{t("wizard.codegs.step5")}</Step>
          <Step n={6}>{t("wizard.codegs.step6")}</Step>
        </ol>

        <CopyCode label="Code.gs" code={code || "// loading…"} />
      </Card>

      <Card className="p-7 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="label-kicker flex items-center gap-1.5"><Wifi className="size-3" /> {t("wizard.scan.title")}</span>
            <p className="mt-1.5 text-[12.5px] text-ink-3 leading-relaxed max-w-2xl">{t("wizard.scan.body")}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="animate-spin" /> : <Wifi />}
            {scanning ? t("wizard.scan.scanning") : t("wizard.scan.cta")}
          </Button>
        </div>

        {scanErr && (
          <p className="inline-flex items-center gap-1.5 text-[12px] text-danger font-mono">
            <AlertTriangle className="size-3" /> {scanErr}
          </p>
        )}

        {scanResults.length > 0 && (
          <ul className="divide-y divide-line-subtle/60 rounded-md border border-line-subtle">
            {scanResults.slice(0, 6).map((r) => (
              <li
                key={r.ip}
                onClick={() => r.ok && setGoogleIP(r.ip)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-bg-inset",
                  !r.ok && "opacity-50 cursor-not-allowed",
                  googleIP === r.ip && "bg-signal/5",
                )}
              >
                <span className="font-mono text-[12px] text-ink-1 tabular-nums">{r.ip}</span>
                <span className="font-mono text-[11.5px] text-ink-3 tabular-nums">
                  {r.ok ? `${r.rtt_ms.toFixed(0)} ms` : "—"}
                </span>
                <div className="flex items-center gap-1.5">
                  {r.recommend && <Badge tone="success">{t("wizard.scan.best")}</Badge>}
                  {googleIP === r.ip && <Badge tone="signal">{t("wizard.scan.selected")}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3 tabular-nums shrink-0 pt-0.5">
        0{n}
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </li>
  );
}
