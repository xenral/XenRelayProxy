import { useState } from "react";
import { AlertTriangle, Check, Cloud, ExternalLink, Loader2, PlugZap } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { testVercelEndpoint } from "@/lib/api";
import { useWizard } from "../_context";
import { VERCEL_DEPLOY_URL } from "../_utils";

export function VercelAccount() {
  const t = useT();
  const {
    authKey,
    accLabel, setAccLabel,
    vercelURL, setVercelURL,
    dailyQuota, setDailyQuota,
  } = useWizard();

  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<null | boolean>(null);
  const [testMsg, setTestMsg] = useState("");

  async function runTest() {
    setTesting(true); setTestOk(null); setTestMsg("");
    try {
      await testVercelEndpoint(vercelURL.trim(), authKey);
      setTestOk(true);
      setTestMsg(t("wizard.vercel.testOk"));
    } catch (err: unknown) {
      setTestOk(false);
      setTestMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="p-7 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-ink-3" />
          <h2 className="text-[16px] font-medium text-ink-1">{t("wizard.vercel.title")}</h2>
        </div>
        <p className="mt-1.5 text-[13.5px] text-ink-2 leading-relaxed max-w-2xl">{t("wizard.vercel.body")}</p>
      </div>

      <ol className="space-y-2 text-[12.5px] text-ink-2 list-none">
        {[t("wizard.vercel.step1"), t("wizard.vercel.step2"), t("wizard.vercel.step3")].map(
          (line, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3 tabular-nums shrink-0 pt-0.5">
                0{i + 1}
              </span>
              <span className="flex-1 leading-relaxed">{line}</span>
            </li>
          ),
        )}
      </ol>

      <Button asChild variant="primary">
        <a href={VERCEL_DEPLOY_URL} target="_blank" rel="noreferrer">
          <Cloud />
          {t("wizard.vercel.deployCta")}
          <ExternalLink />
        </a>
      </Button>

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
          <Label>{t("wizard.account.quota")}</Label>
          <Input
            className="mt-2"
            type="number"
            value={dailyQuota}
            onChange={(e) => setDailyQuota(parseInt(e.target.value || "0", 10) || 20000)}
          />
        </div>
      </div>

      <div>
        <Label>{t("wizard.vercel.urlLabel")}</Label>
        <div className="mt-2 flex gap-2">
          <Input
            className="font-mono text-[12.5px]"
            value={vercelURL}
            onChange={(e) => {
              setVercelURL(e.target.value);
              setTestOk(null);
              setTestMsg("");
            }}
            placeholder="https://my-relay.vercel.app"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={runTest}
            disabled={testing || !vercelURL.trim() || !authKey}
            className="h-9 shrink-0"
          >
            {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
            {testing ? t("wizard.vercel.testing") : t("wizard.vercel.testCta")}
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3 leading-relaxed">{t("wizard.vercel.urlHelp")}</p>

        {testOk === true && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-success font-mono">
            <Check className="size-3" /> {testMsg}
          </p>
        )}
        {testOk === false && (
          <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] text-danger font-mono">
            <AlertTriangle className="size-3 mt-px shrink-0" /> {testMsg}
          </p>
        )}
      </div>
    </Card>
  );
}
