import React, { Component, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BadgeInfo, CheckCheck, CheckCircle2,
  Clock, Copy, FileText, FolderOpen, Gauge, Globe2, Home, Info,
  KeyRound, Languages, Loader2, Play, Plus, RefreshCw, Save,
  Server, Settings, ShieldCheck, ShieldOff, Square, Terminal,
  ToggleLeft, ToggleRight, Trash2, Users, Wifi, WifiOff, X, Zap
} from "lucide-react";
import "./styles.css";
import { LocaleContext, translate, useT, type Locale } from "./i18n";

/* ─── Types ──────────────────────────────────────────────────── */

type Account = {
  label: string; email?: string; script_id?: string; script_ids?: string[];
  account_type: string; enabled: boolean; weight: number; daily_quota: number;
};

type Config = {
  google_ip: string; front_domain: string; auth_key: string;
  listen_host: string; listen_port: number;
  socks5_enabled: boolean; socks5_port: number; log_level: string;
  force_relay_sni_hosts: boolean;
  inject_permissive_cors: boolean;
  cookie_debug_mode: boolean;
  cookie_critical_hosts: string[];
  direct_tunnel_hosts: string[];
  block_long_poll_paths: string[];
  block_hosts: string[];
  accounts: Account[];
  scheduler: {
    strategy: string; quota_safety_margin: number; cooloff_seconds: number;
    throttle_backoff_seconds: number; state_file: string;
    state_persist_interval_seconds: number; keepalive_interval_seconds: number;
    prewarm_on_start: boolean;
  };
};

type Status = {
  state: string; running: boolean; listen_address: string; socks5_address: string;
  active_account?: string; ca_trusted: boolean; last_error?: string; version: string;
};

type Stats = {
  status: Status;
  metrics: {
    total_requests: number; total_errors: number;
    bytes_up: number; bytes_down: number; last_latency_ms: number;
    hosts?: { host: string; requests: number; errors: number; avg_latency_ms: number }[];
  };
  scheduler: {
    total_daily_quota: number; total_calls_today: number; strategy: string;
    accounts?: {
      label: string; enabled: boolean; calls_today: number; daily_quota: number;
      percent_used: number; cooloff_remaining_seconds: number;
      total_errors: number; deployments: number; weight: number;
    }[];
  };
  logs: { time: string; level: string; source?: string; message: string }[];
};

type ScanResult = { ip: string; rtt_ms: number; ok: boolean; error?: string; recommend: boolean };

type CACertInfo = {
  cert_path: string; fingerprint: string; subject: string;
  not_before: string; not_after: string;
  exists: boolean; trusted: boolean; pem: string;
};

type Screen = "home" | "accounts" | "dashboard" | "logs" | "settings" | "cert" | "about";
type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; msg: string };

/* ─── Defaults ───────────────────────────────────────────────── */

const BLANK_CONFIG: Config = {
  google_ip: "216.239.38.120", front_domain: "www.google.com", auth_key: "",
  listen_host: "127.0.0.1", listen_port: 8085, socks5_enabled: true, socks5_port: 1080,
  log_level: "INFO",
  force_relay_sni_hosts: false,
  inject_permissive_cors: false,
  cookie_debug_mode: false,
  cookie_critical_hosts: [],
  direct_tunnel_hosts: [],
  block_long_poll_paths: [],
  block_hosts: [],
  accounts: [],
  scheduler: {
    strategy: "least_loaded", quota_safety_margin: 0.95, cooloff_seconds: 900,
    throttle_backoff_seconds: 60, state_file: "state/scheduler_state.json",
    state_persist_interval_seconds: 30, keepalive_interval_seconds: 180, prewarm_on_start: true,
  },
};

const LOCALE_KEY = "xenrelayproxy.locale";

/* ─── Native bridge ──────────────────────────────────────────── */

function nativeApp() { return (window as any).go?.main?.App; }

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const app = nativeApp();
  if (!app || typeof app[name] !== "function") {
    if (name === "Status")
      return { state: "DISCONNECTED", running: false, listen_address: "127.0.0.1:8085", socks5_address: "", ca_trusted: false, version: "dev" } as T;
    if (name === "Stats")
      return { status: await call<Status>("Status"), metrics: { total_requests: 0, total_errors: 0, bytes_up: 0, bytes_down: 0, last_latency_ms: 0 }, scheduler: { strategy: "least_loaded", total_daily_quota: 0, total_calls_today: 0, accounts: [] }, logs: [] } as T;
    if (name === "GetConfig") return BLANK_CONFIG as T;
    if (name === "ScanFrontIPs") return [] as T;
    if (name === "GetCACertInfo") return { cert_path: "", fingerprint: "", subject: "", not_before: "", not_after: "", exists: false, trusted: false, pem: "" } as T;
    return undefined as T;
  }
  return app[name](...args);
}

/* ─── Error boundary ─────────────────────────────────────────── */

class ErrorBoundary extends Component<{ locale: Locale; children: React.ReactNode }, { err: Error | null }> {
  state = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      const tt = (k: string) => translate(this.props.locale, k);
      return (
        <div className="error-boundary">
          <AlertTriangle size={38} color="var(--danger)" />
          <h2>{tt("error.boundary.title")}</h2>
          <pre>{(this.state.err as Error).message}</pre>
          <button className="btn primary" onClick={() => this.setState({ err: null })}>
            {tt("error.boundary.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Toast system ───────────────────────────────────────────── */

let _tid = 0;
const _listeners = new Set<(t: Toast[]) => void>();
let _toasts: Toast[] = [];

function toast(kind: ToastKind, msg: string) {
  const id = ++_tid;
  _toasts = [..._toasts, { id, kind, msg }];
  _listeners.forEach((f) => f(_toasts));
  setTimeout(() => {
    _toasts = _toasts.filter((t) => t.id !== id);
    _listeners.forEach((f) => f(_toasts));
  }, 3600);
}

function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => { _listeners.add(setToasts); return () => { _listeners.delete(setToasts); }; }, []);
  function dismiss(id: number) {
    _toasts = _toasts.filter((t) => t.id !== id);
    _listeners.forEach((f) => f(_toasts));
  }
  const icons: Record<ToastKind, React.ReactNode> = {
    success: <CheckCircle2 size={15} />,
    error:   <AlertTriangle size={15} />,
    info:    <Info size={15} />,
  };
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {icons[t.kind]}
          <span style={{ flex: 1 }}>{t.msg}</span>
          <X size={13} />
        </div>
      ))}
    </div>
  );
}

/* ─── App ────────────────────────────────────────────────────── */

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [locale, setLocale] = useState<Locale>(() => {
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem(LOCALE_KEY)) || "en";
    return stored === "fa" ? "fa" : "en";
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats]   = useState<Stats | null>(null);
  const [cfg, setCfg]       = useState<Config>(BLANK_CONFIG);
  const [connecting, setConnecting] = useState(false);

  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  function changeLocale(next: Locale) {
    setLocale(next);
    try { localStorage.setItem(LOCALE_KEY, next); } catch {}
  }

  async function refresh() {
    const s = await call<Stats>("Stats");
    setStats(s);
    setStatus(s.status);
  }

  useEffect(() => {
    call<Config>("GetConfig").then(setCfg).catch(() => setCfg(BLANK_CONFIG));
    refresh();
    const id = window.setInterval(refresh, 1500);
    return () => window.clearInterval(id);
  }, []);

  async function startStop() {
    if (connecting) return;
    setConnecting(true);
    try {
      if (status?.running) {
        await call("Stop");
        toast("info", t("toast.disconnected"));
      } else {
        await call("Start");
        toast("success", t("toast.connected"));
      }
      await refresh();
    } catch (err) {
      toast("error", String(err));
    } finally {
      setConnecting(false);
    }
  }

  const isOn   = status?.running === true;
  const btnCls = connecting ? "connecting" : isOn ? "connected" : "";

  type NavItem = [Screen, React.ElementType, string];
  const nav: NavItem[] = [
    ["home",      Home,       "nav.home"],
    ["accounts",  Users,      "nav.accounts"],
    ["dashboard", Gauge,      "nav.dashboard"],
    ["logs",      Terminal,   "nav.logs"],
    ["settings",  Settings,   "nav.settings"],
    ["cert",      ShieldCheck,"nav.cert"],
    ["about",     BadgeInfo,  "nav.about"],
  ];

  return (
    <LocaleContext.Provider value={locale}>
      <ToastContainer />
      <div className="app" dir={locale === "fa" ? "rtl" : "ltr"}>
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-icon"><ShieldCheck size={16} color="#fff" /></div>
            <div>
              <strong>XenRelayProxy</strong>
              <span>v{status?.version ?? "0.2.0"}</span>
            </div>
          </div>
          <nav>
            {nav.map(([id, Icon, key]) => (
              <button key={id} className={screen === id ? "active" : ""} onClick={() => setScreen(id)}>
                <Icon size={15} /><span>{t(key)}</span>
              </button>
            ))}
          </nav>
          <button className="lang" onClick={() => changeLocale(locale === "en" ? "fa" : "en")}>
            <Languages size={15} />
            <span>{t("lang.toggle")}</span>
          </button>
        </aside>

        <main>
          <header>
            <div>
              <h1>{t(nav.find(([id]) => id === screen)?.[2] ?? "nav.home")}</h1>
              <p>{isOn ? status?.listen_address : t("header.notRunning")}</p>
            </div>
            <button
              className={`btn-connect ${btnCls}`}
              onClick={startStop}
              disabled={connecting}
            >
              {connecting
                ? <Loader2 size={15} style={{ animation: "icon-spin 1s linear infinite" }} />
                : isOn ? <Square size={15} /> : <Play size={15} />}
              <span>{connecting ? t("btn.connecting") : isOn ? t("btn.disconnect") : t("btn.connect")}</span>
            </button>
          </header>

          <ErrorBoundary locale={locale}>
            {screen === "home"      && <HomeView status={status} stats={stats} onConnect={startStop} connecting={connecting} />}
            {screen === "accounts"  && <AccountsView cfg={cfg} setCfg={setCfg} refresh={refresh} />}
            {screen === "dashboard" && <DashboardView stats={stats} />}
            {screen === "logs"      && <LogsView stats={stats} />}
            {screen === "settings"  && <SettingsView cfg={cfg} setCfg={setCfg} refresh={refresh} />}
            {screen === "cert"      && <CACertView status={status} />}
            {screen === "about"     && <AboutView version={status?.version ?? "0.2.0"} />}
          </ErrorBoundary>
        </main>
      </div>
    </LocaleContext.Provider>
  );
}

/* ─── HomeView ───────────────────────────────────────────────── */

function HomeView({ status, stats, onConnect, connecting }: {
  status: Status | null; stats: Stats | null;
  onConnect: () => void; connecting: boolean;
}) {
  const t = useT();
  const isOn = status?.running === true;
  const quotaPct = stats?.scheduler.total_daily_quota
    ? Math.round((stats.scheduler.total_calls_today / stats.scheduler.total_daily_quota) * 100)
    : 0;

  const totalReq    = stats?.metrics.total_requests ?? 0;
  const totalErr    = stats?.metrics.total_errors ?? 0;
  const successPct  = totalReq > 0 ? Math.round(((totalReq - totalErr) / totalReq) * 100) : 100;
  const bytesUp     = stats?.metrics.bytes_up ?? 0;
  const bytesDown   = stats?.metrics.bytes_down ?? 0;
  const latency     = stats?.metrics.last_latency_ms ?? 0;
  const callsToday  = stats?.scheduler.total_calls_today ?? 0;
  const quotaTotal  = stats?.scheduler.total_daily_quota  ?? 0;

  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    if (!isOn) { setUptime(0); return; }
    const start = Date.now();
    const id = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isOn]);

  const ringFill = Math.min(quotaPct, 100) * 326.7 / 100;

  const stateText = connecting ? t("status.connecting") : isOn ? t("status.connected") : t("status.disconnected");
  const stateMode = connecting ? "connecting" : isOn ? "on" : "off";

  return (
    <div className="home">
      <section className={`hero hero-${stateMode}`}>
        <div className="hero-bg" aria-hidden />

        <div className="hero-orb">
          {isOn && <>
            <span className="orb-pulse p1" />
            <span className="orb-pulse p2" />
          </>}
          <div className="orb-core">
            {connecting
              ? <Loader2 size={42} style={{ animation: "icon-spin 1s linear infinite" }} />
              : isOn
                ? <Wifi    size={42} />
                : <WifiOff size={42} />}
          </div>
        </div>

        <div className="hero-text">
          <h2 className="hero-state">{stateText}</h2>
          <p className="hero-meta">
            <span className={`live-dot ${isOn ? "on" : ""}`} />
            {connecting
              ? t("hero.establishing")
              : isOn
                ? <>{t("hero.via")} <strong>{status?.active_account || "primary"}</strong> · <Clock size={12} style={{ verticalAlign: -1 }} /> {fmtUptime(uptime)}</>
                : t("hero.tapConnect")}
          </p>
        </div>

        <button
          className={`hero-cta ${isOn ? "off" : "on"}`}
          onClick={onConnect}
          disabled={connecting}
        >
          {connecting
            ? <Loader2 size={18} style={{ animation: "icon-spin 1s linear infinite" }} />
            : isOn ? <Square size={18} /> : <Play size={18} />}
          <span>{connecting ? t("btn.pleaseWait") : isOn ? t("btn.disconnect") : t("btn.connect")}</span>
        </button>

        {status?.last_error && (
          <div className="hero-error">
            <AlertTriangle size={14} />
            <span>{status.last_error}</span>
          </div>
        )}

        {isOn && (
          <div className="route-flow">
            <span className="r-node"><Globe2 size={12} />{t("hero.routeBrowser")}</span>
            <span className="r-arrow" />
            <span className="r-node"><Server size={12} />{t("hero.routeProxy")}</span>
            <span className="r-arrow" />
            <span className="r-node hl"><Zap size={12} />{t("hero.routeAppsScript")}</span>
            <span className="r-arrow" />
            <span className="r-node"><Globe2 size={12} />{t("hero.routeTarget")}</span>
          </div>
        )}
      </section>

      <section className="stat-row">
        <StatTile
          icon={<Activity size={15} />}
          label={t("stat.requests")}
          value={totalReq.toLocaleString()}
          sub={`${totalErr} ${t("stat.errorsSuffix")}`}
          tone="primary"
        />
        <StatTile
          icon={<Zap size={15} />}
          label={t("stat.latency")}
          value={latency.toFixed(0)}
          unit="ms"
          sub={latency < 1500 ? t("stat.fast") : latency < 3000 ? t("stat.normal") : t("stat.slow")}
          tone={latency === 0 ? "muted" : latency < 1500 ? "success" : latency < 3000 ? "warn" : "danger"}
        />
        <StatTile
          icon={<ArrowDown size={15} />}
          label={t("stat.downloaded")}
          value={fmtBytes(bytesDown)}
          sub={<><ArrowUp size={11} /> {fmtBytes(bytesUp)}</>}
          tone="primary"
        />
        <StatTile
          icon={<CheckCircle2 size={15} />}
          label={t("stat.success")}
          value={successPct.toString()}
          unit="%"
          sub={totalReq > 0 ? `${totalReq - totalErr} ${t("stat.ok")}` : t("stat.noTraffic")}
          tone={totalReq === 0 ? "muted" : successPct >= 95 ? "success" : successPct >= 70 ? "warn" : "danger"}
        />
      </section>

      <section className="dual-row">
        <div className="card-panel">
          <div className="panel-head">
            <Gauge size={14} /><span>{t("quota.title")}</span>
            <em className="panel-pill">{stats?.scheduler.strategy || "—"}</em>
          </div>
          <div className="quota-body">
            <div className="quota-ring">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" className="track" />
                <circle cx="60" cy="60" r="52" className={`fill q-${quotaPct >= 90 ? "danger" : quotaPct >= 70 ? "warn" : "ok"}`}
                  style={{ strokeDasharray: `${ringFill} 326.7` }} />
              </svg>
              <div className="quota-center">
                <strong>{quotaPct}<em>%</em></strong>
                <span>{t("quota.usedSuffix")}</span>
              </div>
            </div>
            <div className="quota-info">
              <div className="qrow">
                <span>{t("quota.callsToday")}</span>
                <strong>{callsToday.toLocaleString()}</strong>
              </div>
              <div className="qrow">
                <span>{t("quota.dailyLimit")}</span>
                <strong>{quotaTotal.toLocaleString()}</strong>
              </div>
              <div className="qrow">
                <span>{t("quota.remaining")}</span>
                <strong className={quotaPct >= 90 ? "danger" : ""}>
                  {(quotaTotal - callsToday).toLocaleString()}
                </strong>
              </div>
            </div>
          </div>
        </div>

        <div className="card-panel">
          <div className="panel-head">
            {status?.ca_trusted
              ? <ShieldCheck size={14} color="var(--success)" />
              : <ShieldOff   size={14} color="var(--danger)" />}
            <span>{t("homecert.title")}</span>
          </div>
          <div className="cert-body">
            <div className={`cert-shield ${status?.ca_trusted ? "ok" : "bad"}`}>
              {status?.ca_trusted
                ? <ShieldCheck size={32} />
                : <ShieldOff   size={32} />}
            </div>
            <div className="cert-text">
              <strong className={status?.ca_trusted ? "ok" : "bad"}>
                {status?.ca_trusted ? t("homecert.trusted") : t("homecert.notTrusted")}
              </strong>
              <p>{status?.ca_trusted ? t("homecert.trustedBody") : t("homecert.notTrustedBody")}</p>
            </div>
          </div>
          <div className="cert-rows">
            <div className="qrow">
              <span><Server size={11} /> {t("homecert.httpProxy")}</span>
              <strong className="mono-sm">{status?.listen_address || "—"}</strong>
            </div>
            <div className="qrow">
              <span><Server size={11} /> {t("homecert.socks5")}</span>
              <strong className="mono-sm">{status?.socks5_address || t("homecert.off")}</strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({ icon, label, value, unit, sub, tone }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone: "primary" | "success" | "warn" | "danger" | "muted";
}) {
  return (
    <div className={`stat-tile tone-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <em className="stat-unit">{unit}</em>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
  return `${m}:${sec.toString().padStart(2,"0")}`;
}

/* ─── AccountsView ───────────────────────────────────────────── */

function AccountsView({ cfg, setCfg, refresh }: {
  cfg: Config; setCfg: (c: Config) => void; refresh: () => Promise<void>;
}) {
  const t = useT();
  const accounts = cfg.accounts ?? [];

  function addAccount() {
    const n = accounts.length + 1;
    const a: Account = {
      label: `account${n}`, script_id: "", script_ids: [],
      account_type: "consumer", enabled: true, weight: 1, daily_quota: 20000,
    };
    setCfg({ ...cfg, accounts: [...accounts, a] });
  }

  function removeAccount(i: number) {
    setCfg({ ...cfg, accounts: accounts.filter((_, idx) => idx !== i) });
  }

  async function toggle(label: string, enabled: boolean) {
    try {
      await call("ToggleAccount", label, enabled);
      setCfg({ ...cfg, accounts: accounts.map((a) => a.label === label ? { ...a, enabled } : a) });
      await refresh();
    } catch (err) { toast("error", String(err)); }
  }

  async function save() {
    try {
      await call("SaveConfig", cfg);
      toast("success", t("toast.accountsSaved"));
      await refresh();
    } catch (err) { toast("error", String(err)); }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <button className="btn primary" onClick={save}><Save size={14} />{t("accounts.save")}</button>
        <button className="btn" onClick={addAccount}><Plus size={14} />{t("accounts.add")}</button>
      </div>

      <div className="account-list">
        {accounts.length === 0 && (
          <div className="acct-empty">
            {t("accounts.empty.prefix")}<strong>{t("accounts.add")}</strong>{t("accounts.empty.suffix")}
          </div>
        )}
        {accounts.map((acct, i) => (
          <div className={`account-row${!acct.enabled ? " disabled" : ""}`} key={i}>
            <button
              className="icon-btn"
              onClick={() => toggle(acct.label, !acct.enabled)}
              title={acct.enabled ? t("accounts.disable") : t("accounts.enable")}
              style={{ color: acct.enabled ? "var(--success)" : "var(--muted)" }}
            >
              {acct.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            </button>
            <input
              placeholder={t("accounts.label")}
              value={acct.label}
              onChange={(e) => patchAccount(cfg, setCfg, i, { label: e.target.value })}
            />
            <input
              placeholder={t("accounts.scriptId")}
              value={acct.script_id || acct.script_ids?.[0] || ""}
              onChange={(e) => patchAccount(cfg, setCfg, i, { script_id: e.target.value, script_ids: [e.target.value] })}
            />
            <select
              value={acct.account_type}
              onChange={(e) => patchAccount(cfg, setCfg, i, { account_type: e.target.value })}
            >
              <option value="consumer">{t("accounts.consumer")}</option>
              <option value="workspace">{t("accounts.workspace")}</option>
            </select>
            <input
              type="number"
              placeholder={t("accounts.dailyQuota")}
              value={acct.daily_quota}
              onChange={(e) => patchAccount(cfg, setCfg, i, { daily_quota: Number(e.target.value) })}
            />
            <button
              className="icon-btn"
              onClick={() => removeAccount(i)}
              title={t("accounts.remove")}
              style={{ color: "var(--danger)" }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── DashboardView ──────────────────────────────────────────── */

function DashboardView({ stats }: { stats: Stats | null }) {
  const t = useT();
  const hosts = useMemo(
    () => [...(stats?.metrics.hosts ?? [])].sort((a, b) => b.requests - a.requests).slice(0, 10),
    [stats],
  );
  return (
    <div className="stack">
      <div className="metric-grid">
        <Metric label={t("dash.upload")}   value={fmtBytes(stats?.metrics.bytes_up ?? 0)} />
        <Metric label={t("dash.download")} value={fmtBytes(stats?.metrics.bytes_down ?? 0)} />
        <Metric label={t("dash.requests")} value={stats?.metrics.total_requests ?? 0} />
        <Metric label={t("dash.errors")}   value={stats?.metrics.total_errors ?? 0} />
      </div>
      <table>
        <thead>
          <tr><th>{t("dash.host")}</th><th>{t("dash.requests")}</th><th>{t("dash.errors")}</th><th>{t("dash.avgLatency")}</th></tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.host}>
              <td>{h.host}</td>
              <td>{h.requests}</td>
              <td>{h.errors}</td>
              <td>{h.avg_latency_ms.toFixed(1)} ms</td>
            </tr>
          ))}
          {hosts.length === 0 && (
            <tr><td colSpan={4} style={{ color: "var(--muted)", textAlign: "center" }}>{t("dash.noTraffic")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─── LogsView ───────────────────────────────────────────────── */

function LogsView({ stats }: { stats: Stats | null }) {
  return (
    <div className="logs">
      {(stats?.logs ?? []).slice().reverse().map((e, i) => (
        <div className={`log ${e.level.toLowerCase()}`} key={`${e.time}-${i}`}>
          <span>{new Date(e.time).toLocaleTimeString()}</span>
          <strong>{e.level}</strong>
          <em>{e.source}</em>
          <p>{e.message}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── SettingsView ───────────────────────────────────────────── */

function SettingsView({ cfg, setCfg, refresh }: {
  cfg: Config; setCfg: (c: Config) => void; refresh: () => Promise<void>;
}) {
  const t = useT();
  const [scan, setScan] = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);

  async function save() {
    try {
      await call("SaveConfig", cfg);
      toast("success", t("toast.settingsSaved"));
      await refresh();
    } catch (err) { toast("error", String(err)); }
  }

  async function scanIPs() {
    setScanning(true);
    try {
      setScan(await call<ScanResult[]>("ScanFrontIPs"));
    } catch (err) { toast("error", String(err)); }
    finally { setScanning(false); }
  }

  return (
    <div className="stack">
      <div className="settings-grid">
        <div className="field">
          <label>{t("settings.googleIP")}</label>
          <input value={cfg.google_ip} onChange={(e) => setCfg({ ...cfg, google_ip: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.frontDomain")}</label>
          <input value={cfg.front_domain} onChange={(e) => setCfg({ ...cfg, front_domain: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.authKey")}</label>
          <input type="password" value={cfg.auth_key} onChange={(e) => setCfg({ ...cfg, auth_key: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.logLevel")}</label>
          <select value={cfg.log_level} onChange={(e) => setCfg({ ...cfg, log_level: e.target.value })}>
            {["DEBUG","INFO","WARN","ERROR"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t("settings.listenHost")}</label>
          <input value={cfg.listen_host} onChange={(e) => setCfg({ ...cfg, listen_host: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.httpPort")}</label>
          <input type="number" value={cfg.listen_port} onChange={(e) => setCfg({ ...cfg, listen_port: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>{t("settings.socks5Port")}</label>
          <input type="number" value={cfg.socks5_port} onChange={(e) => setCfg({ ...cfg, socks5_port: Number(e.target.value) })} />
        </div>

        <div className="wide toggle-row">
          <label htmlFor="force-relay-sni" className="toggle-title">
            {t("settings.forceRelaySNI")}
          </label>
          <label className="switch" htmlFor="force-relay-sni">
            <input
              id="force-relay-sni"
              type="checkbox"
              checked={!!cfg.force_relay_sni_hosts}
              onChange={(e) => setCfg({ ...cfg, force_relay_sni_hosts: e.target.checked })}
            />
            <span className="slider" />
          </label>
          <p className="toggle-help">{t("settings.forceRelaySNIHelp")}</p>
        </div>

        <div className="wide toggle-row">
          <label htmlFor="cookie-debug" className="toggle-title">
            {t("settings.cookieDebug")}
          </label>
          <label className="switch" htmlFor="cookie-debug">
            <input
              id="cookie-debug"
              type="checkbox"
              checked={!!cfg.cookie_debug_mode}
              onChange={(e) => setCfg({ ...cfg, cookie_debug_mode: e.target.checked })}
            />
            <span className="slider" />
          </label>
          <p className="toggle-help">{t("settings.cookieDebugHelp")}</p>
        </div>

        <div className="field wide">
          <label>{t("settings.directTunnelHosts")}</label>
          <input
            value={(cfg.direct_tunnel_hosts ?? []).join(", ")}
            onChange={(e) => setCfg({ ...cfg, direct_tunnel_hosts: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="api.x.com, ads-api.x.com"
          />
          <p className="toggle-help">{t("settings.directTunnelHostsHelp")}</p>
        </div>

        <div className="field wide">
          <label>{t("settings.blockHosts")}</label>
          <input
            value={(cfg.block_hosts ?? []).join(", ")}
            onChange={(e) => setCfg({ ...cfg, block_hosts: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="ads.example.com, tracker.example.com"
          />
        </div>

        <div className="wide toolbar">
          <button className="btn primary" onClick={save}><Save size={14} />{t("settings.save")}</button>
          <button className="btn" onClick={scanIPs} disabled={scanning}>
            {scanning
              ? <Loader2 size={14} style={{ animation: "icon-spin 1s linear infinite" }} />
              : <RefreshCw size={14} />}
            {t("settings.scan")}
          </button>
        </div>

        {scan.length > 0 && (
          <div className="wide scan">
            {scan.slice(0, 10).map((r) => (
              <div
                key={r.ip}
                className="scan-row"
                onClick={() => { setCfg({ ...cfg, google_ip: r.ip }); toast("info", t("toast.googleIPSet", { ip: r.ip })); }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {r.recommend ? <CheckCircle2 size={14} color="var(--success)" /> : <Globe2 size={14} color="var(--muted)" />}
                  {r.ip}
                </span>
                <strong style={{ fontSize: 12, color: r.ok ? "var(--success)" : "var(--danger)" }}>
                  {r.ok ? `${r.rtt_ms.toFixed(1)} ms` : r.error}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CACertView ─────────────────────────────────────────────── */

type GuideTab = "auto" | "macos" | "firefox" | "windows" | "linux";

function CACertView({ status }: { status: Status | null }) {
  const t = useT();
  const [tab, setTab]         = useState<GuideTab>("auto");
  const [info, setInfo]       = useState<CACertInfo | null>(null);
  const [copied, setCopied]   = useState(false);

  async function loadInfo() {
    const i = await call<CACertInfo>("GetCACertInfo");
    setInfo(i);
  }

  useEffect(() => { loadInfo(); }, []);

  async function installCA() {
    try {
      await call("InstallCA");
      await loadInfo();
      toast("success", t("toast.caInstalled"));
    } catch (err) { toast("error", String(err)); }
  }

  async function uninstallCA() {
    try {
      await call("UninstallCA");
      await loadInfo();
      toast("info", t("toast.caRemoved"));
    } catch (err) { toast("error", String(err)); }
  }

  async function reveal() {
    try { await call("RevealCACert"); }
    catch (err) { toast("error", String(err)); }
  }

  async function copyPEM() {
    if (!info?.pem) return;
    await navigator.clipboard.writeText(info.pem);
    setCopied(true);
    toast("success", t("toast.pemCopied"));
    setTimeout(() => setCopied(false), 2000);
  }

  const trusted = info?.trusted ?? status?.ca_trusted ?? false;
  const certPath = info?.cert_path ?? "";

  const tabs: [GuideTab, string][] = [
    ["auto",    t("cert.tab.auto")],
    ["macos",   t("cert.tab.macos")],
    ["firefox", t("cert.tab.firefox")],
    ["windows", t("cert.tab.windows")],
    ["linux",   t("cert.tab.linux")],
  ];

  return (
    <div className="ca-guide">
      {info?.exists && (
        <div className="cert-info-grid">
          <div className="cert-info-item" style={{ gridColumn: "1 / -1" }}>
            <dt>{t("cert.status")}</dt>
            <dd style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <span className={`badge ${trusted ? "ok" : "no"}`}>
                {trusted ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {trusted ? t("cert.trustedBySystem") : t("cert.notTrusted")}
              </span>
              <button className="btn" onClick={reveal}><FolderOpen size={13} />{t("cert.showInFinder")}</button>
              <button className="btn" onClick={copyPEM}>
                {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                {t("cert.copyPEM")}
              </button>
              {trusted && (
                <button className="btn danger" onClick={uninstallCA}>
                  <ShieldOff size={13} />{t("cert.remove")}
                </button>
              )}
            </dd>
          </div>
          <div className="cert-info-item">
            <dt>{t("cert.subject")}</dt>
            <dd>{info.subject || "—"}</dd>
          </div>
          <div className="cert-info-item">
            <dt>{t("cert.validUntil")}</dt>
            <dd style={{ color: info.not_after && new Date(info.not_after) < new Date() ? "var(--danger)" : undefined }}>
              {info.not_after || "—"}
            </dd>
          </div>
          <div className="cert-info-item" style={{ gridColumn: "1 / -1" }}>
            <dt>{t("cert.fingerprint")}</dt>
            <dd className="mono">{info.fingerprint || "—"}</dd>
          </div>
          <div className="cert-info-item" style={{ gridColumn: "1 / -1" }}>
            <dt>{t("cert.path")}</dt>
            <dd className="mono">{certPath}</dd>
          </div>
        </div>
      )}

      <div>
        <div className="tabs" style={{ marginBottom: 12 }}>
          {tabs.map(([id, label]) => (
            <button key={id} className={`tab-btn${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "auto"    && <AutoGuide    trusted={trusted} onInstall={installCA} />}
        {tab === "macos"   && <MacOSGuide   certPath={certPath} />}
        {tab === "firefox" && <FirefoxGuide certPath={certPath} />}
        {tab === "windows" && <WindowsGuide certPath={certPath} />}
        {tab === "linux"   && <LinuxGuide   certPath={certPath} />}
      </div>
    </div>
  );
}

function AutoGuide({ trusted, onInstall }: { trusted: boolean; onInstall: () => void }) {
  const t = useT();
  return (
    <div className="guide-steps">
      <div className="step">
        <div className="step-num">1</div>
        <div className="step-body">
          <strong>{t("cert.auto.title")}</strong>
          <p>{t("cert.auto.body")}</p>
          <div style={{ marginTop: 10 }}>
            {trusted
              ? <span className="badge ok"><CheckCircle2 size={12} />{t("cert.alreadyInstalled")}</span>
              : <button className="btn primary" onClick={onInstall}><KeyRound size={14} />{t("cert.install")}</button>}
          </div>
        </div>
      </div>
      <div className="step">
        <div className="step-num warn">!</div>
        <div className="step-body">
          <strong>{t("cert.auto.firefoxNote.title")}</strong>
          <p>
            {t("cert.auto.firefoxNote.bodyA")}
            <strong>{t("cert.tab.firefox")}</strong>
            {t("cert.auto.firefoxNote.bodyB")}
          </p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">2</div>
        <div className="step-body">
          <strong>{t("cert.auto.restart.title")}</strong>
          <p>{t("cert.auto.restart.body")}</p>
        </div>
      </div>
    </div>
  );
}

function MacOSGuide({ certPath }: { certPath: string }) {
  const t = useT();
  const path = certPath || "~/Library/Application Support/XenRelayProxy/ca/ca.crt";
  return (
    <div className="guide-steps">
      <div className="step">
        <div className="step-num">1</div>
        <div className="step-body">
          <strong>{t("cert.macos.optionATitle")}</strong>
          <p>{t("cert.macos.optionABody")}</p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">2</div>
        <div className="step-body">
          <strong>{t("cert.macos.optionBTitle")}</strong>
          <code className="block">{`security add-trusted-cert -r trustRoot \\\n  -k ~/Library/Keychains/login.keychain-db \\\n  "${path}"`}</code>
        </div>
      </div>
      <div className="step">
        <div className="step-num">3</div>
        <div className="step-body">
          <strong>{t("cert.macos.optionCTitle")}</strong>
          <p>
            {t("cert.macos.optionCBodyA")}<strong>Keychain Access</strong>
            {t("cert.macos.optionCBodyB")}<em>{t("cert.macos.alwaysTrust")}</em>
            {t("cert.macos.optionCBodyC")}
          </p>
        </div>
      </div>
    </div>
  );
}

function FirefoxGuide({ certPath }: { certPath: string }) {
  const t = useT();
  const path = certPath || "~/Library/Application Support/XenRelayProxy/ca/ca.crt";
  return (
    <div className="guide-steps">
      <div className="step">
        <div className="step-num warn">!</div>
        <div className="step-body">
          <strong>{t("cert.firefox.warnTitle")}</strong>
          <p>{t("cert.firefox.warnBody")}</p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">1</div>
        <div className="step-body">
          <strong>{t("cert.firefox.openTitle")}</strong>
          <p>
            {t("cert.firefox.openBodyA")}<code>about:preferences#privacy</code>
            {t("cert.firefox.openBodyB")}<strong>{t("cert.firefox.viewCerts")}</strong>
          </p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">2</div>
        <div className="step-body">
          <strong>{t("cert.firefox.importTitle")}</strong>
          <p>
            {t("cert.firefox.importBodyA")}<strong>{t("cert.firefox.authorities")}</strong>
            {t("cert.firefox.importBodyB")}<strong>{t("cert.firefox.import")}</strong>
            {t("cert.firefox.importBodyC")}
          </p>
          <code className="block">{path}</code>
        </div>
      </div>
      <div className="step">
        <div className="step-num">3</div>
        <div className="step-body">
          <strong>{t("cert.firefox.trustTitle")}</strong>
          <p>
            {t("cert.firefox.trustBodyA")}<em>{t("cert.firefox.trustText")}</em>
            {t("cert.firefox.trustBodyB")}<strong>{t("cert.firefox.ok")}</strong>.
          </p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">4</div>
        <div className="step-body">
          <strong>{t("cert.firefox.restartTitle")}</strong>
          <p>{t("cert.firefox.restartBody")}</p>
        </div>
      </div>
    </div>
  );
}

function WindowsGuide({ certPath }: { certPath: string }) {
  const t = useT();
  return (
    <div className="guide-steps">
      <div className="step">
        <div className="step-num">1</div>
        <div className="step-body">
          <strong>{t("cert.windows.autoTitle")}</strong>
          <p>
            {t("cert.windows.autoBodyA")}<code>certutil -addstore -user Root</code>
            {t("cert.windows.autoBodyB")}
          </p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">2</div>
        <div className="step-body">
          <strong>{t("cert.windows.guiTitle")}</strong>
          <p>
            {t("cert.windows.guiBodyA")}<code>Win+R</code>
            {t("cert.windows.guiBodyB")}<code>certmgr.msc</code>
            {t("cert.windows.guiBodyC")}<em>{t("cert.windows.trustedRoot")}</em>
            {t("cert.windows.guiBodyD")}
          </p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">3</div>
        <div className="step-body">
          <strong>{t("cert.windows.cliTitle")}</strong>
          <code className="block">{`certutil -addstore Root "${certPath || "C:\\path\\to\\ca.crt"}"`}</code>
        </div>
      </div>
    </div>
  );
}

function LinuxGuide({ certPath }: { certPath: string }) {
  const t = useT();
  const path = certPath || "/path/to/ca.crt";
  return (
    <div className="guide-steps">
      <div className="step">
        <div className="step-num">1</div>
        <div className="step-body">
          <strong>{t("cert.linux.debianTitle")}</strong>
          <code className="block">{`sudo cp "${path}" /usr/local/share/ca-certificates/xenrelayproxy.crt\nsudo update-ca-certificates`}</code>
        </div>
      </div>
      <div className="step">
        <div className="step-num">2</div>
        <div className="step-body">
          <strong>{t("cert.linux.fedoraTitle")}</strong>
          <code className="block">{`sudo cp "${path}" /etc/pki/ca-trust/source/anchors/xenrelayproxy.crt\nsudo update-ca-trust`}</code>
        </div>
      </div>
      <div className="step">
        <div className="step-num">3</div>
        <div className="step-body">
          <strong>{t("cert.linux.firefoxTitle")}</strong>
          <p>
            {t("cert.linux.firefoxBodyA")}<strong>{t("cert.tab.firefox")}</strong>
            {t("cert.linux.firefoxBodyB")}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── AboutView ──────────────────────────────────────────────── */

function AboutView({ version }: { version: string }) {
  const t = useT();
  return (
    <div className="about">
      <div className="about-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <FileText size={22} />
          <div>
            <h2 style={{ fontSize: 18 }}>XenRelayProxy</h2>
            <span className="badge ver" style={{ marginTop: 4 }}>v{version}</span>
          </div>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.6 }}>
          {t("about.tagline")}
        </p>
        <h3>{t("about.defaults")}</h3>
        <ul>
          <li>{t("about.httpProxy")} — <code style={{ fontFamily: "monospace", fontSize: 13 }}>127.0.0.1:8085</code></li>
          <li>{t("about.socks5Proxy")} — <code style={{ fontFamily: "monospace", fontSize: 13 }}>127.0.0.1:1080</code></li>
          <li>{t("about.stats")} — <code style={{ fontFamily: "monospace", fontSize: 13 }}>http://_proxy_stats/</code> {t("about.statsThrough")}</li>
        </ul>
      </div>
      <div className="about-card">
        <h3>{t("about.dataDir")}</h3>
        <ul>
          <li><code style={{ fontFamily: "monospace", fontSize: 13 }}>~/Library/Application Support/XenRelayProxy/config.json</code></li>
          <li><code style={{ fontFamily: "monospace", fontSize: 13 }}>~/Library/Application Support/XenRelayProxy/ca/</code></li>
        </ul>
      </div>
    </div>
  );
}

/* ─── Shared helpers ─────────────────────────────────────────── */

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function patchAccount(cfg: Config, setCfg: (c: Config) => void, i: number, patch: Partial<Account>) {
  setCfg({ ...cfg, accounts: cfg.accounts.map((a, idx) => idx === i ? { ...a, ...patch } : a) });
}

function fmtBytes(v: number) {
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─── Mount ──────────────────────────────────────────────────── */

createRoot(document.getElementById("root")!).render(<App />);
