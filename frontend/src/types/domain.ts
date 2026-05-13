export type Account = {
  label: string;
  email?: string;
  script_id?: string;
  script_ids?: string[];
  account_type: string;
  enabled: boolean;
  weight: number;
  daily_quota: number;
  provider?: string;
  vercel_url?: string;
};

export type SchedulerConfig = {
  strategy: string;
  quota_safety_margin: number;
  cooloff_seconds: number;
  throttle_backoff_seconds: number;
  state_file: string;
  state_persist_interval_seconds: number;
  keepalive_interval_seconds: number;
  prewarm_on_start: boolean;
};

export type Config = {
  google_ip: string;
  front_domain: string;
  auth_key: string;
  listen_host: string;
  listen_port: number;
  socks5_enabled: boolean;
  socks5_port: number;
  log_level: string;
  force_relay_sni_hosts: boolean;
  inject_permissive_cors: boolean;
  cookie_debug_mode: boolean;
  cookie_critical_hosts: string[];
  direct_tunnel_hosts: string[];
  block_long_poll_paths: string[];
  block_hosts: string[];
  max_response_body_bytes: number;
  chunked_download_min_size: number;
  chunked_download_chunk_size: number;
  chunked_download_max_parallel: number;
  chunked_download_max_chunks: number;
  chunked_download_extensions: string[];
  accounts: Account[];
  scheduler: SchedulerConfig;
  mode?: string;
  setup_completed?: boolean;
};

export type Status = {
  state: string;
  running: boolean;
  listen_address: string;
  socks5_address: string;
  active_account?: string;
  ca_trusted: boolean;
  last_error?: string;
  version: string;
};

export type HostMetric = {
  host: string;
  requests: number;
  errors: number;
  avg_latency_ms: number;
};

export type AccountStat = {
  label: string;
  enabled: boolean;
  calls_today: number;
  daily_quota: number;
  percent_used: number;
  cooloff_remaining_seconds: number;
  total_errors: number;
  deployments: number;
  weight: number;
};

export type LogEntry = {
  time: string;
  level: string;
  source?: string;
  message: string;
};

export type DownloadInfo = {
  id: string;
  url: string;
  filename: string;
  total_bytes: number;
  done_bytes: number;
  chunks: number;
  done_chunks: number;
  status: "active" | "done" | "failed" | "cancelled";
  error?: string;
  started_at: string;
  bytes_per_sec: number;
};

export type Stats = {
  status: Status;
  metrics: {
    total_requests: number;
    total_errors: number;
    bytes_up: number;
    bytes_down: number;
    last_latency_ms: number;
    hosts?: HostMetric[];
  };
  scheduler: {
    total_daily_quota: number;
    total_calls_today: number;
    strategy: string;
    accounts?: AccountStat[];
  };
  logs: LogEntry[];
  downloads: DownloadInfo[];
};

export type ScanResult = {
  ip: string;
  rtt_ms: number;
  ok: boolean;
  error?: string;
  recommend: boolean;
};

export type CACertInfo = {
  cert_path: string;
  fingerprint: string;
  subject: string;
  not_before: string;
  not_after: string;
  exists: boolean;
  trusted: boolean;
  pem: string;
};

export const BLANK_CONFIG: Config = {
  google_ip: "216.239.38.120",
  front_domain: "www.google.com",
  auth_key: "",
  listen_host: "127.0.0.1",
  listen_port: 8085,
  socks5_enabled: true,
  socks5_port: 1080,
  log_level: "INFO",
  force_relay_sni_hosts: false,
  inject_permissive_cors: false,
  cookie_debug_mode: false,
  cookie_critical_hosts: [],
  direct_tunnel_hosts: [],
  block_long_poll_paths: [],
  block_hosts: [],
  max_response_body_bytes: 1073741824,
  chunked_download_min_size: 5242880,
  chunked_download_chunk_size: 524288,
  chunked_download_max_parallel: 8,
  chunked_download_max_chunks: 256,
  chunked_download_extensions: [
    ".bin", ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".exe", ".msi", ".dmg", ".deb", ".rpm", ".apk", ".iso", ".img",
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".mp3", ".flac", ".wav",
    ".aac", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".wasm",
  ],
  accounts: [],
  scheduler: {
    strategy: "least_loaded",
    quota_safety_margin: 0.95,
    cooloff_seconds: 900,
    throttle_backoff_seconds: 60,
    state_file: "state/scheduler_state.json",
    state_persist_interval_seconds: 30,
    keepalive_interval_seconds: 180,
    prewarm_on_start: true,
  },
};
