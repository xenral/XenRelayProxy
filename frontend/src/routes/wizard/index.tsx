import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, SkipForward, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { useUI } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  generateAuthKey, getConfig, markSetupCompleted, saveConfig, startRelay,
} from "@/lib/api";
import { QK } from "@/lib/queries";
import type { Account, Config } from "@/types/domain";
import { BLANK_CONFIG } from "@/types/domain";

import { WizardCtx } from "./_context";
import { ORDER, isPlaceholderKey, type RelayMode, type WizardStep } from "./_utils";
import { StepRail } from "./_rail";

import { Welcome } from "./steps/Welcome";
import { Mode } from "./steps/Mode";
import { Auth } from "./steps/Auth";
import { AppsScriptAccount } from "./steps/AppsScriptAccount";
import { VercelAccount } from "./steps/VercelAccount";
import { Cert } from "./steps/Cert";
import { Done } from "./steps/Done";

export default function WizardPage() {
  const t = useT();
  const locale = useUI((s) => s.locale);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep] = useState<WizardStep>("welcome");
  const [furthest, setFurthest] = useState(0);

  const [mode, setMode] = useState<RelayMode>("apps_script");
  const [authKey, setAuthKey] = useState("");
  const [frontDomain, setFrontDomain] = useState("www.google.com");
  const [googleIP, setGoogleIP] = useState("216.239.38.120");
  const [accLabel, setAccLabel] = useState("default");
  const [accEmail, setAccEmail] = useState("");
  const [scriptIDs, setScriptIDs] = useState<string[]>([]);
  const [scriptDraft, setScriptDraft] = useState("");
  const [vercelURL, setVercelURL] = useState("");
  const [dailyQuota, setDailyQuota] = useState(20000);

  const [savingErr, setSavingErr] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  // Hydrate from existing config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getConfig();
        if (cancelled) return;
        if (cfg.mode === "vercel" || cfg.mode === "apps_script") setMode(cfg.mode as RelayMode);
        if (cfg.auth_key && !isPlaceholderKey(cfg.auth_key)) {
          setAuthKey(cfg.auth_key);
        } else {
          const fresh = await generateAuthKey();
          if (!cancelled) setAuthKey(fresh);
        }
        if (cfg.front_domain) setFrontDomain(cfg.front_domain);
        if (cfg.google_ip) setGoogleIP(cfg.google_ip);
        if (cfg.accounts && cfg.accounts.length > 0) {
          const a = cfg.accounts[0];
          setAccLabel(a.label || "default");
          setAccEmail(a.email || "");
          setScriptIDs(a.script_ids || (a.script_id ? [a.script_id] : []));
          if (a.vercel_url) setVercelURL(a.vercel_url);
          setDailyQuota(a.daily_quota || 20000);
        }
      } catch {
        try {
          const fresh = await generateAuthKey();
          if (!cancelled) setAuthKey(fresh);
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stepIndex = ORDER.indexOf(step);
  const progressPct = (stepIndex / (ORDER.length - 1)) * 100;

  function go(next: WizardStep) {
    const i = ORDER.indexOf(next);
    setStep(next);
    if (i > furthest) setFurthest(i);
  }

  // Treat any non-empty chipDraft as a deployment ID the user typed but
  // never committed with Enter — we still want to save it.
  function effectiveScriptIDs(): string[] {
    const d = scriptDraft.trim();
    if (!d) return scriptIDs;
    return scriptIDs.includes(d) ? scriptIDs : [...scriptIDs, d];
  }

  async function persistDraft(extra: Partial<Config> = {}) {
    setSavingErr(null);
    try {
      const cfg = await getConfig();
      const accountBase: Account = {
        label: accLabel || "default",
        email: accEmail,
        account_type: "consumer",
        enabled: true,
        weight: 1,
        daily_quota: dailyQuota,
      };
      if (mode === "vercel") {
        accountBase.provider = "vercel";
        accountBase.vercel_url = vercelURL.trim();
        const prev = (cfg.accounts || []).find((a) => a.label === (accLabel || "default"));
        if (prev?.script_ids?.length) accountBase.script_ids = prev.script_ids;
      } else {
        const ids = effectiveScriptIDs();
        accountBase.script_ids = ids;
        accountBase.provider = "";
        accountBase.vercel_url = "";
        // Keep `scriptIDs` in sync with what we just persisted so the Done
        // summary and Settings page reflect the same value.
        if (ids.length !== scriptIDs.length) {
          setScriptIDs(ids);
          setScriptDraft("");
        }
      }
      const merged: Config = {
        ...(BLANK_CONFIG as Config),
        ...cfg,
        mode,
        auth_key: authKey,
        front_domain: frontDomain,
        google_ip: googleIP,
        accounts: [
          accountBase,
          ...((cfg.accounts || []).filter(
            (a) => a.label && a.label !== (accLabel || "default"),
          )),
        ],
        ...extra,
      };
      await saveConfig(merged);
      // Re-entering the wizard from the sidebar means useConfig has already
      // cached a Config under QK.config with staleTime: Infinity. Without
      // this, Settings / Accounts keep showing pre-wizard values.
      qc.setQueryData(QK.config, merged);
      qc.invalidateQueries({ queryKey: QK.config });
    } catch (err: unknown) {
      setSavingErr(err instanceof Error ? err.message : String(err));
    }
  }

  function back() {
    if (stepIndex > 0) go(ORDER[stepIndex - 1]);
  }

  async function next() {
    if (step === "auth") {
      if (isPlaceholderKey(authKey)) {
        setSavingErr(t("wizard.auth.placeholderError"));
        return;
      }
      if (mode === "apps_script" && !frontDomain.trim()) {
        setSavingErr(t("wizard.auth.frontDomainRequired"));
        return;
      }
    }
    if (step === "account") {
      if (mode === "vercel") {
        if (!vercelURL.trim()) {
          setSavingErr(t("wizard.vercel.urlRequired"));
          return;
        }
        if (!/^https?:\/\//i.test(vercelURL.trim())) {
          setSavingErr(t("wizard.vercel.urlScheme"));
          return;
        }
      } else if (effectiveScriptIDs().length === 0) {
        setSavingErr(t("wizard.account.scriptIdsRequired"));
        return;
      }
    }
    await persistDraft();
    if (stepIndex < ORDER.length - 1) go(ORDER[stepIndex + 1]);
  }

  const ctxValue = useMemo(
    () => ({
      mode, setMode,
      authKey, setAuthKey,
      frontDomain, setFrontDomain,
      googleIP, setGoogleIP,
      accLabel, setAccLabel,
      accEmail, setAccEmail,
      scriptIDs, setScriptIDs,
      scriptDraft, setScriptDraft,
      vercelURL, setVercelURL,
      dailyQuota, setDailyQuota,
    }),
    [mode, authKey, frontDomain, googleIP, accLabel, accEmail, scriptIDs, scriptDraft, vercelURL, dailyQuota],
  );

  async function finish() {
    await persistDraft({ setup_completed: true });
    try { await markSetupCompleted(); } catch {}
    try { await startRelay(); } catch {}
    navigate("/", { replace: true });
  }

  async function skipWizard() {
    setSkipping(true);
    try {
      await markSetupCompleted();
      qc.invalidateQueries({ queryKey: QK.config });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setSavingErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSkipping(false);
    }
  }

  return (
    <WizardCtx.Provider value={ctxValue}>
      <div
        dir={locale === "fa" ? "rtl" : "ltr"}
        className="relative h-screen overflow-y-auto bg-bg-base"
      >
        <div className="atmosphere" />

        <div className="relative z-10 mx-auto max-w-5xl px-6 py-10 md:py-14">
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <span className="label-kicker">XenRelayProxy</span>
              <h1 className="display mt-1 text-[28px] leading-none tracking-tightest text-ink-1">
                {t("wizard.welcome.title").split(" ").slice(0, 3).join(" ")}
              </h1>
            </div>
            <div className="flex flex-1 max-w-md items-end gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-3">
                  <span>
                    {String(stepIndex + 1).padStart(2, "0")} / {String(ORDER.length).padStart(2, "0")}
                  </span>
                  <span>{Math.round(progressPct)}%</span>
                </div>
                <Progress value={progressPct} className="mt-2" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={skipWizard}
                disabled={skipping}
                title={t("wizard.skip")}
              >
                <SkipForward />
                {t("wizard.skip")}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-8 md:flex-row">
            <StepRail
              current={stepIndex}
              furthest={furthest}
              onJump={(i) => go(ORDER[i])}
            />

            <div className="min-w-0 flex-1 animate-fade-in" key={step}>
              {step === "welcome" && <Welcome onNext={() => go("mode")} />}
              {step === "mode" && <Mode />}
              {step === "auth" && <Auth />}
              {step === "account" && (mode === "vercel" ? <VercelAccount /> : <AppsScriptAccount />)}
              {step === "cert" && <Cert />}
              {step === "done" && <Done onStart={finish} />}

              {savingErr && (
                <div className="mt-4 flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger">
                  <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                  <span className="flex-1 leading-relaxed">{savingErr}</span>
                  <button
                    onClick={() => setSavingErr(null)}
                    className="text-danger/70 hover:text-danger transition-colors"
                    aria-label="dismiss"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {step !== "done" && step !== "welcome" && (
                <div className="mt-6 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    onClick={back}
                    disabled={stepIndex === 0}
                  >
                    <ArrowLeft />
                    {t("wizard.back")}
                  </Button>
                  <Button variant="primary" onClick={next}>
                    {t(step === "cert" ? "wizard.review" : "wizard.next")}
                    <ArrowRight />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </WizardCtx.Provider>
  );
}
