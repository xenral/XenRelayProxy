import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, ExternalLink,
  KeyRound, Loader2, RefreshCw, Rocket, ShieldCheck, ShieldOff,
  Sparkles, Wifi, Wand2, X,
} from "lucide-react";
import { translate, type Locale } from "./i18n";

/* ─── Native bridge ──────────────────────────────────────────── */

function nativeApp() { return (window as any).go?.main?.App; }

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const app = nativeApp();
  if (!app || typeof app[name] !== "function") {
    if (name === "GenerateAuthKey") {
      const bytes = new Uint8Array(32);
      (window.crypto || (window as any).msCrypto).getRandomValues(bytes);
      return btoa(String.fromCharCode(...bytes)) as unknown as T;
    }
    if (name === "GetCodeGS") return ("// Code.gs unavailable in dev preview.\n") as unknown as T;
    if (name === "IsCATrusted") return false as unknown as T;
    if (name === "ScanFrontIPs") return [] as unknown as T;
    if (name === "GetConfig") return {} as unknown as T;
    return undefined as unknown as T;
  }
  return app[name](...args);
}

/* ─── Types ──────────────────────────────────────────────────── */

type Step = "welcome" | "auth" | "account" | "cert" | "done";
const ORDER: Step[] = ["welcome", "auth", "account", "cert", "done"];

type ScanResult = { ip: string; rtt_ms: number; ok: boolean; error?: string; recommend: boolean };

type WizardProps = {
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  onComplete: () => void;
};

/* ─── Step rail ──────────────────────────────────────────────── */

function StepRail({ t, current, furthest, onJump }: {
  t: (k: string) => string;
  current: number;
  furthest: number;
  onJump: (i: number) => void;
}) {
  const items: [Step, string, React.ElementType][] = [
    ["welcome", "wizard.rail.welcome", Sparkles],
    ["auth", "wizard.rail.auth", KeyRound],
    ["account", "wizard.rail.account", Wand2],
    ["cert", "wizard.rail.cert", ShieldCheck],
    ["done", "wizard.rail.done", Rocket],
  ];
  return (
    <aside className="wiz-rail">
      <div className="wiz-rail-title">{t("wizard.rail.title")}</div>
      <ol className="wiz-rail-list">
        {items.map(([_id, key, Icon], i) => {
          const visited = i <= furthest;
          const active = i === current;
          const done = i < furthest;
          return (
            <li
              key={key}
              className={`wiz-rail-item ${active ? "active" : ""} ${visited ? "visited" : ""} ${done ? "done" : ""}`}
              onClick={() => visited && onJump(i)}
            >
              <span className="wiz-rail-num">
                {done ? <Check size={11} /> : i + 1}
              </span>
              <Icon size={13} />
              <span className="wiz-rail-label">{t(key)}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* ─── Top-level component ────────────────────────────────────── */

export default function Wizard({ locale, onLocaleChange, onComplete }: WizardProps) {
  const t = (k: string, vars?: Record<string, string | number>) => translate(locale, k, vars);

  const [step, setStep] = useState<Step>("welcome");
  const [furthest, setFurthest] = useState(0);

  const [authKey, setAuthKey] = useState("");
  const [frontDomain, setFrontDomain] = useState("www.google.com");
  const [googleIP, setGoogleIP] = useState("216.239.38.120");

  const [accLabel, setAccLabel] = useState("default");
  const [accEmail, setAccEmail] = useState("");
  const [scriptIDs, setScriptIDs] = useState<string[]>([]);
  const [dailyQuota, setDailyQuota] = useState(20000);

  const [savingErr, setSavingErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg: any = await call("GetConfig");
        if (cancelled) return;
        if (cfg.auth_key && !isPlaceholderKey(cfg.auth_key)) setAuthKey(cfg.auth_key);
        else {
          const fresh = await call<string>("GenerateAuthKey");
          if (!cancelled) setAuthKey(fresh);
        }
        if (cfg.front_domain) setFrontDomain(cfg.front_domain);
        if (cfg.google_ip) setGoogleIP(cfg.google_ip);
        if (cfg.accounts && cfg.accounts.length > 0) {
          const a = cfg.accounts[0];
          setAccLabel(a.label || "default");
          setAccEmail(a.email || "");
          setScriptIDs(a.script_ids || (a.script_id ? [a.script_id] : []));
          setDailyQuota(a.daily_quota || 20000);
        }
      } catch {
        try {
          const fresh = await call<string>("GenerateAuthKey");
          if (!cancelled) setAuthKey(fresh);
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stepIndex = ORDER.indexOf(step);
  const progressPct = (stepIndex / (ORDER.length - 1)) * 100;

  function go(next: Step) {
    const i = ORDER.indexOf(next);
    setStep(next);
    if (i > furthest) setFurthest(i);
  }

  async function persistDraft(extra: Partial<any> = {}) {
    setSavingErr(null);
    try {
      const cfg: any = await call("GetConfig");
      const merged = {
        ...cfg,
        auth_key: authKey,
        front_domain: frontDomain,
        google_ip: googleIP,
        accounts: [
          {
            label: accLabel || "default",
            email: accEmail,
            script_ids: scriptIDs,
            account_type: "consumer",
            enabled: true,
            weight: 1,
            daily_quota: dailyQuota,
          },
          ...((cfg.accounts || []).filter((a: any) => a.label && a.label !== (accLabel || "default"))),
        ],
        ...extra,
      };
      await call("SaveConfig", merged);
    } catch (err: any) {
      setSavingErr(String(err?.message || err));
    }
  }

  function back() {
    if (stepIndex > 0) go(ORDER[stepIndex - 1]);
  }

  async function next() {
    if (step === "auth") {
      if (isPlaceholderKey(authKey)) { setSavingErr(t("wizard.auth.placeholderError")); return; }
      if (!frontDomain.trim()) { setSavingErr(t("wizard.auth.frontDomainRequired")); return; }
    }
    if (step === "account") {
      if (scriptIDs.length === 0) { setSavingErr(t("wizard.account.scriptIdsRequired")); return; }
    }
    await persistDraft();
    if (stepIndex < ORDER.length - 1) go(ORDER[stepIndex + 1]);
  }

  return (
    <div className="wiz-page" dir={locale === "fa" ? "rtl" : "ltr"}>
      <div className="wiz-progress">
        <div className="wiz-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="wiz-layout">
        <StepRail
          t={t}
          current={stepIndex}
          furthest={furthest}
          onJump={(i) => go(ORDER[i])}
        />

        <div className="wiz-content">
          {step === "welcome" && (
            <WelcomeStep
              t={t}
              locale={locale}
              onLocaleChange={onLocaleChange}
              onNext={() => go("auth")}
            />
          )}
          {step === "auth" && (
            <AuthStep
              t={t}
              authKey={authKey}
              setAuthKey={setAuthKey}
              frontDomain={frontDomain}
              setFrontDomain={setFrontDomain}
            />
          )}
          {step === "account" && (
            <AccountStep
              t={t}
              authKey={authKey}
              accLabel={accLabel} setAccLabel={setAccLabel}
              accEmail={accEmail} setAccEmail={setAccEmail}
              scriptIDs={scriptIDs} setScriptIDs={setScriptIDs}
              dailyQuota={dailyQuota} setDailyQuota={setDailyQuota}
              googleIP={googleIP} setGoogleIP={setGoogleIP}
            />
          )}
          {step === "cert" && <CertStep t={t} />}
          {step === "done" && (
            <DoneStep
              t={t}
              authKey={authKey}
              accLabel={accLabel}
              scriptIDs={scriptIDs}
              googleIP={googleIP}
              onStart={async () => {
                await persistDraft({ setup_completed: true });
                try { await call("MarkSetupCompleted"); } catch {}
                try { await call("Start"); } catch {}
                onComplete();
              }}
            />
          )}

          {savingErr && (
            <div className="wiz-error-bar">
              <AlertTriangle size={13} />
              <span>{savingErr}</span>
              <button className="wiz-error-dismiss" onClick={() => setSavingErr(null)}>
                <X size={12} />
              </button>
            </div>
          )}

          {step !== "done" && (
            <div className="wiz-footer">
              <button className="wiz-btn ghost" onClick={back} disabled={stepIndex === 0}>
                <ArrowLeft size={14} />
                <span>{t("wizard.back")}</span>
              </button>
              <button className="wiz-btn primary" onClick={next}>
                <span>{t(step === "cert" ? "wizard.review" : "wizard.next")}</span>
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Step 1: Welcome ────────────────────────────────────────── */

function WelcomeStep({ t, locale, onLocaleChange, onNext }: {
  t: (k: string, vars?: any) => string;
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  onNext: () => void;
}) {
  return (
    <div className="wiz-card wiz-welcome">
      <div className="wiz-orb-static">
        <Sparkles size={32} />
      </div>

      <h1>{t("wizard.welcome.title")}</h1>
      <p className="wiz-lead">{t("wizard.welcome.body")}</p>

      <ul className="wiz-roadmap">
        {[
          ["wizard.welcome.r1", KeyRound],
          ["wizard.welcome.r2", Wand2],
          ["wizard.welcome.r3", ShieldCheck],
          ["wizard.welcome.r4", Rocket],
        ].map(([k, Icon]: any, i) => (
          <li className="wiz-roadmap-item" key={k}>
            <span className="wiz-roadmap-num">{i + 1}</span>
            <Icon size={14} />
            <span>{t(k)}</span>
          </li>
        ))}
      </ul>

      <div className="wiz-langrow">
        <span className="wiz-langrow-label">{t("wizard.welcome.lang")}</span>
        <div className="wiz-langgroup">
          <button
            className={`wiz-langbtn ${locale === "en" ? "active" : ""}`}
            onClick={() => onLocaleChange("en")}
          >English</button>
          <button
            className={`wiz-langbtn ${locale === "fa" ? "active" : ""}`}
            onClick={() => onLocaleChange("fa")}
          >فارسی</button>
        </div>
      </div>

      <button className="wiz-btn primary big" onClick={onNext}>
        <span>{t("wizard.welcome.cta")}</span>
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

/* ─── Step 2: Auth Key + Front Domain ────────────────────────── */

function AuthStep({ t, authKey, setAuthKey, frontDomain, setFrontDomain }: {
  t: (k: string) => string;
  authKey: string; setAuthKey: (s: string) => void;
  frontDomain: string; setFrontDomain: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const placeholder = isPlaceholderKey(authKey);

  async function regen() {
    setBusy(true);
    try {
      const fresh = await call<string>("GenerateAuthKey");
      setAuthKey(fresh);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(authKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="wiz-card">
      <div className="wiz-card-head">
        <KeyRound size={18} />
        <h2>{t("wizard.auth.title")}</h2>
      </div>
      <p className="wiz-lead">{t("wizard.auth.body")}</p>

      <label className="wiz-label">{t("wizard.auth.keyLabel")}</label>
      <div className="wiz-key-row">
        <input
          className={`wiz-input mono ${placeholder ? "danger" : ""}`}
          value={authKey}
          onChange={(e) => setAuthKey(e.target.value)}
          spellCheck={false}
        />
        <button className="wiz-iconbtn" onClick={regen} disabled={busy} title={t("wizard.auth.regenerate")}>
          {busy ? <Loader2 size={14} /> : <RefreshCw size={14} />}
        </button>
        <button className="wiz-iconbtn" onClick={copy} title={t("wizard.auth.copy")}>
          {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
        </button>
      </div>
      {placeholder && (
        <div className="wiz-hint danger">
          <AlertTriangle size={12} /> {t("wizard.auth.placeholderError")}
        </div>
      )}
      <div className="wiz-hint">{t("wizard.auth.help")}</div>

      <label className="wiz-label" style={{ marginTop: 18 }}>{t("wizard.auth.frontDomainLabel")}</label>
      <input
        className="wiz-input mono"
        value={frontDomain}
        onChange={(e) => setFrontDomain(e.target.value)}
        spellCheck={false}
        placeholder="www.google.com"
      />
      <div className="wiz-hint">{t("wizard.auth.frontDomainHelp")}</div>
    </div>
  );
}

/* ─── Step 3: Account + Code.gs + IP scan ────────────────────── */

function AccountStep({
  t, authKey,
  accLabel, setAccLabel, accEmail, setAccEmail,
  scriptIDs, setScriptIDs, dailyQuota, setDailyQuota,
  googleIP, setGoogleIP,
}: {
  t: (k: string, vars?: any) => string;
  authKey: string;
  accLabel: string; setAccLabel: (s: string) => void;
  accEmail: string; setAccEmail: (s: string) => void;
  scriptIDs: string[]; setScriptIDs: (a: string[]) => void;
  dailyQuota: number; setDailyQuota: (n: number) => void;
  googleIP: string; setGoogleIP: (s: string) => void;
}) {
  const [chipDraft, setChipDraft] = useState("");
  const [code, setCode] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanErr, setScanErr] = useState<string | null>(null);

  useEffect(() => {
    call<string>("GetCodeGS").then(setCode).catch(() => setCode(""));
  }, []);

  function addChip() {
    const v = chipDraft.trim();
    if (!v) return;
    if (scriptIDs.includes(v)) { setChipDraft(""); return; }
    setScriptIDs([...scriptIDs, v]);
    setChipDraft("");
  }

  function removeChip(s: string) {
    setScriptIDs(scriptIDs.filter((x) => x !== s));
  }

  async function copyTo(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1400);
    } catch {}
  }

  async function runScan() {
    setScanning(true); setScanErr(null); setScanResults([]);
    try {
      const r = await call<ScanResult[]>("ScanFrontIPs");
      setScanResults(r);
      const best = r.find((x) => x.recommend) || r.find((x) => x.ok);
      if (best) setGoogleIP(best.ip);
    } catch (err: any) {
      setScanErr(String(err?.message || err));
    } finally {
      setScanning(false);
    }
  }

  const personalisedSnippet = useMemo(() => {
    return `const AUTH_KEY = "${authKey || "<your auth key>"}";`;
  }, [authKey]);

  return (
    <div className="wiz-card">
      <div className="wiz-card-head">
        <Wand2 size={18} />
        <h2>{t("wizard.account.title")}</h2>
      </div>
      <p className="wiz-lead">{t("wizard.account.body")}</p>

      <div className="wiz-grid-2">
        <div>
          <label className="wiz-label">{t("wizard.account.label")}</label>
          <input className="wiz-input" value={accLabel} onChange={(e) => setAccLabel(e.target.value)} />
        </div>
        <div>
          <label className="wiz-label">{t("wizard.account.email")}</label>
          <input className="wiz-input" type="email" value={accEmail} onChange={(e) => setAccEmail(e.target.value)} placeholder="you@gmail.com" />
        </div>
      </div>

      <label className="wiz-label" style={{ marginTop: 14 }}>{t("wizard.account.scriptIds")}</label>
      <div className="wiz-chips">
        {scriptIDs.map((s) => (
          <span key={s} className="wiz-chip">
            <span className="mono-sm">{s.length > 24 ? s.slice(0, 18) + "…" + s.slice(-4) : s}</span>
            <button onClick={() => removeChip(s)} aria-label="remove">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="wiz-chip-input mono"
          value={chipDraft}
          onChange={(e) => setChipDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addChip();
            } else if (e.key === "Backspace" && !chipDraft && scriptIDs.length > 0) {
              setScriptIDs(scriptIDs.slice(0, -1));
            }
          }}
          placeholder={t("wizard.account.scriptIdsPlaceholder")}
        />
      </div>

      <div className="wiz-grid-2" style={{ marginTop: 14 }}>
        <div>
          <label className="wiz-label">{t("wizard.account.quota")}</label>
          <input
            type="number"
            className="wiz-input"
            value={dailyQuota}
            onChange={(e) => setDailyQuota(parseInt(e.target.value || "0", 10) || 20000)}
          />
        </div>
        <div>
          <label className="wiz-label">{t("wizard.account.googleIP")}</label>
          <input
            className="wiz-input mono"
            value={googleIP}
            onChange={(e) => setGoogleIP(e.target.value)}
          />
        </div>
      </div>

      {/* Code.gs deploy panel */}
      <div className="wiz-deploy">
        <div className="wiz-deploy-head">
          <Wand2 size={14} />
          <h3>{t("wizard.codegs.title")}</h3>
        </div>
        <p className="wiz-hint">{t("wizard.codegs.body")}</p>

        <ol className="wiz-steps">
          <li>
            <span>{t("wizard.codegs.step1")}</span>
            <a className="wiz-extlink" href="https://script.google.com" target="_blank" rel="noreferrer">
              script.google.com <ExternalLink size={11} />
            </a>
          </li>
          <li>{t("wizard.codegs.step2")}</li>
          <li>{t("wizard.codegs.step3")}</li>
          <li>
            <span>{t("wizard.codegs.step4")}</span>
            <div className="wiz-snippet">
              <code className="mono-sm">{personalisedSnippet}</code>
              <button className="wiz-iconbtn small" onClick={() => copyTo("snippet", personalisedSnippet)}>
                {copiedKey === "snippet" ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
              </button>
            </div>
          </li>
          <li>{t("wizard.codegs.step5")}</li>
          <li>{t("wizard.codegs.step6")}</li>
        </ol>

        <div className="wiz-codeblock">
          <div className="wiz-codeblock-head">
            <span className="mono-sm">Code.gs</span>
            <button className="wiz-iconbtn small" onClick={() => copyTo("code", code)}>
              {copiedKey === "code"
                ? <><Check size={12} color="var(--success)" /> <span>{t("wizard.codegs.copied")}</span></>
                : <><Copy size={12} /> <span>{t("wizard.codegs.copy")}</span></>}
            </button>
          </div>
          <pre className="wiz-codeblock-body"><code>{code || "// loading…"}</code></pre>
        </div>
      </div>

      {/* IP scan panel */}
      <div className="wiz-scan">
        <div className="wiz-scan-head">
          <Wifi size={14} />
          <h3>{t("wizard.scan.title")}</h3>
          <button className="wiz-btn ghost small" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 size={12} /> : <Wifi size={12} />}
            <span>{scanning ? t("wizard.scan.scanning") : t("wizard.scan.cta")}</span>
          </button>
        </div>
        <p className="wiz-hint">{t("wizard.scan.body")}</p>
        {scanErr && <div className="wiz-hint danger"><AlertTriangle size={12} /> {scanErr}</div>}
        {scanResults.length > 0 && (
          <div className="wiz-scan-results">
            {scanResults.slice(0, 6).map((r) => (
              <div
                key={r.ip}
                className={`wiz-scan-row ${r.recommend ? "best" : ""} ${!r.ok ? "fail" : ""}`}
                onClick={() => r.ok && setGoogleIP(r.ip)}
              >
                <span className="mono-sm">{r.ip}</span>
                <span className="wiz-scan-rtt">{r.ok ? `${r.rtt_ms.toFixed(0)} ms` : "—"}</span>
                {r.recommend && <span className="wiz-pill ok">{t("wizard.scan.best")}</span>}
                {googleIP === r.ip && <span className="wiz-pill primary">{t("wizard.scan.selected")}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Step 4: CA Cert ────────────────────────────────────────── */

function CertStep({ t }: { t: (k: string) => string }) {
  const [trusted, setTrusted] = useState<boolean>(false);
  const [installing, setInstalling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    call<boolean>("IsCATrusted").then((v) => { if (!cancelled) setTrusted(!!v); }).catch(() => {});
    return () => { cancelled = true; if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  async function install() {
    setInstalling(true); setErr(null);
    try {
      await call("InstallCA");
      const start = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const v = await call<boolean>("IsCATrusted");
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
    } catch (e: any) {
      setErr(String(e?.message || e));
      setInstalling(false);
    }
  }

  return (
    <div className="wiz-card">
      <div className="wiz-card-head">
        <ShieldCheck size={18} />
        <h2>{t("wizard.cert.title")}</h2>
      </div>
      <p className="wiz-lead">{t("wizard.cert.body")}</p>

      <div className={`wiz-cert-state ${trusted ? "ok" : installing ? "warn" : "off"}`}>
        <div className="wiz-cert-icon">
          {installing
            ? <Loader2 size={28} />
            : trusted
              ? <ShieldCheck size={28} />
              : <ShieldOff size={28} />}
        </div>
        <div className="wiz-cert-text">
          <strong>
            {installing ? t("wizard.cert.installing") : trusted ? t("wizard.cert.trusted") : t("wizard.cert.notTrusted")}
          </strong>
          <span>
            {trusted ? t("wizard.cert.trustedBody") : t("wizard.cert.notTrustedBody")}
          </span>
        </div>
        {!trusted && (
          <button className="wiz-btn primary" onClick={install} disabled={installing}>
            {installing ? <Loader2 size={14} /> : <ShieldCheck size={14} />}
            <span>{installing ? t("wizard.cert.installing") : t("wizard.cert.install")}</span>
          </button>
        )}
      </div>

      {err && <div className="wiz-hint danger"><AlertTriangle size={12} /> {err}</div>}

      <div className="wiz-hint" style={{ marginTop: 14 }}>{t("wizard.cert.skipNote")}</div>
    </div>
  );
}

/* ─── Step 5: Done ───────────────────────────────────────────── */

function DoneStep({ t, authKey, accLabel, scriptIDs, googleIP, onStart }: {
  t: (k: string, vars?: any) => string;
  authKey: string; accLabel: string; scriptIDs: string[]; googleIP: string;
  onStart: () => void;
}) {
  const [starting, setStarting] = useState(false);

  return (
    <div className="wiz-card wiz-done">
      <div className="wiz-done-icon">
        <Check size={36} />
      </div>

      <h1>{t("wizard.done.title")}</h1>
      <p className="wiz-lead">{t("wizard.done.body")}</p>

      <div className="wiz-summary">
        <div className="wiz-summary-row">
          <span>{t("wizard.done.summaryAuthKey")}</span>
          <strong className="mono-sm">{maskKey(authKey)}</strong>
        </div>
        <div className="wiz-summary-row">
          <span>{t("wizard.done.summaryAccount")}</span>
          <strong>{accLabel} · {scriptIDs.length} {t("wizard.done.summaryDeployments")}</strong>
        </div>
        <div className="wiz-summary-row">
          <span>{t("wizard.done.summaryFrontIP")}</span>
          <strong className="mono-sm">{googleIP}</strong>
        </div>
      </div>

      <button
        className="wiz-btn primary big"
        disabled={starting}
        onClick={async () => {
          setStarting(true);
          try { await onStart(); } finally { setStarting(false); }
        }}
      >
        {starting ? <Loader2 size={15} /> : <Rocket size={15} />}
        <span>{starting ? t("wizard.done.starting") : t("wizard.done.start")}</span>
      </button>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */

function isPlaceholderKey(k: string): boolean {
  const v = (k || "").trim();
  if (!v) return true;
  if (v === "CHANGE_ME_TO_A_STRONG_SECRET") return true;
  if (v === "your-secret-password-here") return true;
  return false;
}

function maskKey(k: string): string {
  if (!k) return "—";
  if (k.length < 12) return k;
  return k.slice(0, 6) + "…" + k.slice(-4);
}
