import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BadgeInfo,
  CheckCircle2,
  FileText,
  Gauge,
  Globe2,
  Home,
  KeyRound,
  Languages,
  List,
  Play,
  Power,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  ShieldOff,
  Square,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Users
} from "lucide-react";
import "./styles.css";

type Account = {
  label: string;
  email?: string;
  script_id?: string;
  script_ids?: string[];
  account_type: string;
  enabled: boolean;
  weight: number;
  daily_quota: number;
};

type Config = {
  google_ip: string;
  front_domain: string;
  auth_key: string;
  listen_host: string;
  listen_port: number;
  socks5_enabled: boolean;
  socks5_port: number;
  log_level: string;
  accounts: Account[];
  scheduler: {
    strategy: string;
    quota_safety_margin: number;
    cooloff_seconds: number;
    throttle_backoff_seconds: number;
    state_file: string;
    state_persist_interval_seconds: number;
    keepalive_interval_seconds: number;
    prewarm_on_start: boolean;
  };
};

type Status = {
  state: string;
  running: boolean;
  listen_address: string;
  socks5_address: string;
  active_account?: string;
  ca_trusted: boolean;
  last_error?: string;
  version: string;
};

type Stats = {
  status: Status;
  metrics: {
    total_requests: number;
    total_errors: number;
    bytes_up: number;
    bytes_down: number;
    last_latency_ms: number;
    hosts?: { host: string; requests: number; errors: number; avg_latency_ms: number }[];
  };
  scheduler: {
    total_daily_quota: number;
    total_calls_today: number;
    strategy: string;
    accounts?: {
      label: string;
      enabled: boolean;
      calls_today: number;
      daily_quota: number;
      percent_used: number;
      cooloff_remaining_seconds: number;
      total_errors: number;
      deployments: number;
      weight: number;
    }[];
  };
  logs: { time: string; level: string; source?: string; message: string }[];
};

type ScanResult = { ip: string; rtt_ms: number; ok: boolean; error?: string; recommend: boolean };
type Screen = "home" | "accounts" | "dashboard" | "logs" | "settings" | "about";
type Locale = "en" | "fa";

const fallbackConfig: Config = {
  google_ip: "216.239.38.120",
  front_domain: "www.google.com",
  auth_key: "",
  listen_host: "127.0.0.1",
  listen_port: 8085,
  socks5_enabled: true,
  socks5_port: 1080,
  log_level: "INFO",
  accounts: [
    {
      label: "primary",
      script_id: "",
      script_ids: [],
      account_type: "consumer",
      enabled: true,
      weight: 1,
      daily_quota: 20000
    }
  ],
  scheduler: {
    strategy: "least_loaded",
    quota_safety_margin: 0.95,
    cooloff_seconds: 900,
    throttle_backoff_seconds: 60,
    state_file: "state/scheduler_state.json",
    state_persist_interval_seconds: 30,
    keepalive_interval_seconds: 180,
    prewarm_on_start: true
  }
};

function nativeApp() {
  return (window as any).go?.main?.App;
}

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const app = nativeApp();
  if (!app || typeof app[name] !== "function") {
    if (name === "Status") {
      return {
        state: "DISCONNECTED",
        running: false,
        listen_address: "127.0.0.1:8085",
        socks5_address: "127.0.0.1:1080",
        ca_trusted: false,
        version: "dev"
      } as T;
    }
    if (name === "Stats") {
      return {
        status: await call<Status>("Status"),
        metrics: { total_requests: 0, total_errors: 0, bytes_up: 0, bytes_down: 0, last_latency_ms: 0 },
        scheduler: { strategy: "least_loaded", total_daily_quota: 0, total_calls_today: 0, accounts: [] },
        logs: []
      } as T;
    }
    if (name === "GetConfig") return fallbackConfig as T;
    if (name === "ScanFrontIPs") return [] as T;
    return undefined as T;
  }
  return app[name](...args);
}

const copy = {
  en: {
    Home: "Home",
    Accounts: "Accounts",
    Dashboard: "Dashboard",
    Logs: "Logs",
    Settings: "Settings",
    About: "About",
    Connect: "Connect",
    Disconnect: "Disconnect",
    Connected: "Connected",
    Disconnected: "Disconnected",
    Save: "Save",
    InstallCA: "Install CA",
    UninstallCA: "Remove CA",
    Scan: "Scan IPs"
  },
  fa: {
    Home: "خانه",
    Accounts: "حساب‌ها",
    Dashboard: "داشبورد",
    Logs: "گزارش‌ها",
    Settings: "تنظیمات",
    About: "درباره",
    Connect: "اتصال",
    Disconnect: "قطع اتصال",
    Connected: "متصل",
    Disconnected: "قطع",
    Save: "ذخیره",
    InstallCA: "نصب گواهی",
    UninstallCA: "حذف گواهی",
    Scan: "اسکن IP"
  }
};

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [locale, setLocale] = useState<Locale>("en");
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cfg, setCfg] = useState<Config>(fallbackConfig);
  const [message, setMessage] = useState("");
  const t = copy[locale];

  async function refresh() {
    const [nextStatus, nextStats] = await Promise.all([call<Status>("Status"), call<Stats>("Stats")]);
    setStatus(nextStatus);
    setStats(nextStats);
  }

  useEffect(() => {
    call<Config>("GetConfig").then(setCfg).catch(() => setCfg(fallbackConfig));
    refresh();
    const id = window.setInterval(refresh, 1500);
    return () => window.clearInterval(id);
  }, []);

  async function startStop() {
    try {
      if (status?.running) {
        await call("Stop");
      } else {
        await call("Start");
      }
      await refresh();
    } catch (err) {
      setMessage(String(err));
    }
  }

  const nav = [
    ["home", Home, t.Home],
    ["accounts", Users, t.Accounts],
    ["dashboard", Gauge, t.Dashboard],
    ["logs", Terminal, t.Logs],
    ["settings", Settings, t.Settings],
    ["about", BadgeInfo, t.About]
  ] as const;

  return (
    <div className="app" dir={locale === "fa" ? "rtl" : "ltr"}>
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={26} />
          <div>
            <strong>XenRelayProxy</strong>
            <span>{status?.version ?? "0.1.0"}</span>
          </div>
        </div>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button key={id} className={screen === id ? "active" : ""} onClick={() => setScreen(id)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="lang" onClick={() => setLocale(locale === "en" ? "fa" : "en")}>
          <Languages size={18} />
          <span>{locale === "en" ? "FA" : "EN"}</span>
        </button>
      </aside>

      <main>
        <header>
          <div>
            <h1>{nav.find(([id]) => id === screen)?.[2]}</h1>
            <p>{status?.listen_address || "127.0.0.1:8085"}</p>
          </div>
          <button className={status?.running ? "danger primary" : "primary"} onClick={startStop}>
            {status?.running ? <Square size={18} /> : <Play size={18} />}
            <span>{status?.running ? t.Disconnect : t.Connect}</span>
          </button>
        </header>

        {message && (
          <div className="banner" onClick={() => setMessage("")}>
            {message}
          </div>
        )}

        {screen === "home" && <HomeView status={status} stats={stats} t={t} />}
        {screen === "accounts" && <AccountsView cfg={cfg} setCfg={setCfg} refresh={refresh} />}
        {screen === "dashboard" && <DashboardView stats={stats} />}
        {screen === "logs" && <LogsView stats={stats} />}
        {screen === "settings" && <SettingsView cfg={cfg} setCfg={setCfg} refresh={refresh} t={t} />}
        {screen === "about" && <AboutView />}
      </main>
    </div>
  );
}

function HomeView({ status, stats, t }: { status: Status | null; stats: Stats | null; t: typeof copy.en }) {
  const quota = stats?.scheduler.total_daily_quota
    ? Math.round((stats.scheduler.total_calls_today / stats.scheduler.total_daily_quota) * 100)
    : 0;
  return (
    <section className="home-grid">
      <div className="connect-panel">
        <div className={status?.running ? "status-dot on" : "status-dot"} />
        <h2>{status?.running ? t.Connected : t.Disconnected}</h2>
        <p>{status?.active_account || "primary"}</p>
        <div className="traffic">
          <Metric label="Requests" value={stats?.metrics.total_requests ?? 0} />
          <Metric label="Errors" value={stats?.metrics.total_errors ?? 0} />
          <Metric label="Latency" value={`${(stats?.metrics.last_latency_ms ?? 0).toFixed(1)} ms`} />
        </div>
      </div>
      <div className="side-panel">
        <div className="mini-title">
          <Activity size={18} />
          <span>Quota</span>
        </div>
        <div className="bar">
          <span style={{ width: `${Math.min(quota, 100)}%` }} />
        </div>
        <strong>{quota}%</strong>
        <p>{stats?.scheduler.total_calls_today ?? 0} / {stats?.scheduler.total_daily_quota ?? 0}</p>
      </div>
      <div className="side-panel">
        <div className="mini-title">
          {status?.ca_trusted ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
          <span>Certificate</span>
        </div>
        <strong>{status?.ca_trusted ? "Trusted" : "Not trusted"}</strong>
        <p>{status?.socks5_address || "SOCKS5 disabled"}</p>
      </div>
    </section>
  );
}

function AccountsView({ cfg, setCfg, refresh }: { cfg: Config; setCfg: (cfg: Config) => void; refresh: () => Promise<void> }) {
  async function toggle(label: string, enabled: boolean) {
    await call("ToggleAccount", label, enabled);
    setCfg({ ...cfg, accounts: cfg.accounts.map((a) => (a.label === label ? { ...a, enabled } : a)) });
    await refresh();
  }
  async function save() {
    await call("SaveConfig", cfg);
    await refresh();
  }
  return (
    <section className="stack">
      <div className="toolbar">
        <button onClick={save}><Save size={18} />Save</button>
      </div>
      <div className="account-list">
        {cfg.accounts.map((account, index) => (
          <article className="account-row" key={account.label}>
            <button className="icon-button" onClick={() => toggle(account.label, !account.enabled)} title="Toggle account">
              {account.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
            </button>
            <input value={account.label} onChange={(e) => updateAccount(cfg, setCfg, index, { label: e.target.value })} />
            <input value={account.script_id || account.script_ids?.[0] || ""} onChange={(e) => updateAccount(cfg, setCfg, index, { script_id: e.target.value, script_ids: [e.target.value] })} />
            <select value={account.account_type} onChange={(e) => updateAccount(cfg, setCfg, index, { account_type: e.target.value })}>
              <option value="consumer">consumer</option>
              <option value="workspace">workspace</option>
            </select>
            <input type="number" value={account.daily_quota} onChange={(e) => updateAccount(cfg, setCfg, index, { daily_quota: Number(e.target.value) })} />
          </article>
        ))}
      </div>
    </section>
  );
}

function DashboardView({ stats }: { stats: Stats | null }) {
  const hosts = useMemo(() => [...(stats?.metrics.hosts ?? [])].sort((a, b) => b.requests - a.requests).slice(0, 8), [stats]);
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Up" value={formatBytes(stats?.metrics.bytes_up ?? 0)} />
        <Metric label="Down" value={formatBytes(stats?.metrics.bytes_down ?? 0)} />
        <Metric label="Requests" value={stats?.metrics.total_requests ?? 0} />
        <Metric label="Errors" value={stats?.metrics.total_errors ?? 0} />
      </div>
      <table>
        <thead><tr><th>Host</th><th>Requests</th><th>Errors</th><th>Avg latency</th></tr></thead>
        <tbody>
          {hosts.map((host) => (
            <tr key={host.host}><td>{host.host}</td><td>{host.requests}</td><td>{host.errors}</td><td>{host.avg_latency_ms.toFixed(1)} ms</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LogsView({ stats }: { stats: Stats | null }) {
  return (
    <section className="logs">
      {(stats?.logs ?? []).slice().reverse().map((entry, idx) => (
        <div className={`log ${entry.level.toLowerCase()}`} key={`${entry.time}-${idx}`}>
          <span>{new Date(entry.time).toLocaleTimeString()}</span>
          <strong>{entry.level}</strong>
          <em>{entry.source}</em>
          <p>{entry.message}</p>
        </div>
      ))}
    </section>
  );
}

function SettingsView({ cfg, setCfg, refresh, t }: { cfg: Config; setCfg: (cfg: Config) => void; refresh: () => Promise<void>; t: typeof copy.en }) {
  const [scan, setScan] = useState<ScanResult[]>([]);
  async function save() {
    await call("SaveConfig", cfg);
    await refresh();
  }
  async function installCA() {
    await call("InstallCA");
    await refresh();
  }
  async function uninstallCA() {
    await call("UninstallCA");
    await refresh();
  }
  async function scanIPs() {
    setScan(await call<ScanResult[]>("ScanFrontIPs"));
  }
  return (
    <section className="settings-grid">
      <label>Google IP<input value={cfg.google_ip} onChange={(e) => setCfg({ ...cfg, google_ip: e.target.value })} /></label>
      <label>Front domain<input value={cfg.front_domain} onChange={(e) => setCfg({ ...cfg, front_domain: e.target.value })} /></label>
      <label>Auth key<input type="password" value={cfg.auth_key} onChange={(e) => setCfg({ ...cfg, auth_key: e.target.value })} /></label>
      <label>Listen host<input value={cfg.listen_host} onChange={(e) => setCfg({ ...cfg, listen_host: e.target.value })} /></label>
      <label>HTTP port<input type="number" value={cfg.listen_port} onChange={(e) => setCfg({ ...cfg, listen_port: Number(e.target.value) })} /></label>
      <label>SOCKS5 port<input type="number" value={cfg.socks5_port} onChange={(e) => setCfg({ ...cfg, socks5_port: Number(e.target.value) })} /></label>
      <div className="toolbar wide">
        <button onClick={save}><Save size={18} />{t.Save}</button>
        <button onClick={installCA}><KeyRound size={18} />{t.InstallCA}</button>
        <button onClick={uninstallCA}><ShieldOff size={18} />{t.UninstallCA}</button>
        <button onClick={scanIPs}><RefreshCw size={18} />{t.Scan}</button>
      </div>
      {scan.length > 0 && (
        <div className="scan wide">
          {scan.slice(0, 10).map((row) => (
            <button key={row.ip} onClick={() => setCfg({ ...cfg, google_ip: row.ip })}>
              {row.recommend ? <CheckCircle2 size={16} /> : <Globe2 size={16} />}
              <span>{row.ip}</span>
              <strong>{row.ok ? `${row.rtt_ms.toFixed(1)} ms` : row.error}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AboutView() {
  return (
    <section className="about">
      <FileText size={24} />
      <h2>XenRelayProxy</h2>
      <p>Go/Wails desktop relay proxy using Apps Script protocol v2.</p>
      <ul>
        <li>HTTP proxy: 127.0.0.1:8085</li>
        <li>SOCKS5 proxy: 127.0.0.1:1080</li>
        <li>Stats endpoint: http://_proxy_stats/ through the proxy</li>
      </ul>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function updateAccount(cfg: Config, setCfg: (cfg: Config) => void, index: number, patch: Partial<Account>) {
  setCfg({ ...cfg, accounts: cfg.accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<App />);

