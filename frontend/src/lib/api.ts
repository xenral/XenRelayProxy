import {
  BLANK_CONFIG,
  type CACertInfo,
  type Config,
  type ScanResult,
  type Stats,
  type Status,
} from "@/types/domain";

type NativeApp = Record<string, (...args: unknown[]) => Promise<unknown>>;

function nativeApp(): NativeApp | undefined {
  return (window as unknown as { go?: { main?: { App?: NativeApp } } }).go?.main?.App;
}

export function hasNative(): boolean {
  return !!nativeApp();
}

const DEV_STATUS: Status = {
  state: "DISCONNECTED",
  running: false,
  listen_address: "127.0.0.1:8085",
  socks5_address: "",
  ca_trusted: false,
  version: "dev",
};

const DEV_STATS: Stats = {
  status: DEV_STATUS,
  metrics: { total_requests: 0, total_errors: 0, bytes_up: 0, bytes_down: 0, last_latency_ms: 0 },
  scheduler: { strategy: "least_loaded", total_daily_quota: 0, total_calls_today: 0, accounts: [] },
  logs: [],
  downloads: [],
};

const DEV_CERT: CACertInfo = {
  cert_path: "",
  fingerprint: "",
  subject: "",
  not_before: "",
  not_after: "",
  exists: false,
  trusted: false,
  pem: "",
};

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const app = nativeApp();
  if (!app || typeof app[name] !== "function") {
    throw new Error(`Wails binding "${name}" is not available in browser preview.`);
  }
  return app[name](...args) as Promise<T>;
}

async function safeCall<T>(name: string, fallback: T, ...args: unknown[]): Promise<T> {
  const app = nativeApp();
  if (!app || typeof app[name] !== "function") return fallback;
  return (await app[name](...args)) as T;
}

// ─── Status / Stats ───────────────────────────────────────────

export const getStatus = () => safeCall<Status>("Status", DEV_STATUS);
export const getStats = () => safeCall<Stats>("Stats", DEV_STATS);

// ─── Lifecycle ────────────────────────────────────────────────

export const startRelay = () => call<void>("Start");
export const stopRelay = () => call<void>("Stop");
export const setMode = (mode: string) => call<void>("SetMode", mode);

// ─── Config ───────────────────────────────────────────────────

export const getConfig = () => safeCall<Config>("GetConfig", BLANK_CONFIG);
export const saveConfig = (c: Config) => call<void>("SaveConfig", c);
export const validateConfig = (c: Config) => call<void>("ValidateConfig", c);

// ─── Auth + scheduler ────────────────────────────────────────

export const generateAuthKey = async (): Promise<string> => {
  const app = nativeApp();
  if (app && typeof app["GenerateAuthKey"] === "function") {
    return (await app["GenerateAuthKey"]()) as string;
  }
  const bytes = new Uint8Array(32);
  (window.crypto || (window as unknown as { msCrypto: Crypto }).msCrypto).getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
};

export const toggleAccount = (label: string, enabled: boolean) =>
  call<void>("ToggleAccount", label, enabled);

// ─── CA cert ─────────────────────────────────────────────────

export const getCACertInfo = () => safeCall<CACertInfo>("GetCACertInfo", DEV_CERT);
export const installCA = () => call<void>("InstallCA");
export const uninstallCA = () => call<void>("UninstallCA");
export const isCATrusted = () => safeCall<boolean>("IsCATrusted", false);
export const revealCACert = () => call<void>("RevealCACert");

// ─── Front IPs ───────────────────────────────────────────────

export const scanFrontIPs = () => safeCall<ScanResult[]>("ScanFrontIPs", []);
export const testVercelEndpoint = (url: string, token: string) =>
  call<void>("TestVercelEndpoint", url, token);

// ─── Wizard ──────────────────────────────────────────────────

export const isSetupCompleted = () => safeCall<boolean>("IsSetupCompleted", true);
export const markSetupCompleted = () => call<void>("MarkSetupCompleted");
export const getCodeGS = () => safeCall<string>("GetCodeGS", "// Code.gs unavailable in dev preview.\n");

// ─── Downloads ───────────────────────────────────────────────

export const cancelDownload = (id: string) => call<void>("CancelDownload", id);
