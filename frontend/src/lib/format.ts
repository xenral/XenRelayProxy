export function fmtBytes(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "0 B";
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = v / 1024;
  for (const u of units) {
    if (value < 1024) return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${u}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} EB`;
}

export function fmtBytesPerSec(v: number): string {
  return `${fmtBytes(v)}/s`;
}

export function fmtUptime(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0s";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || d || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.slice(0, 2).join(" ");
}

export function fmtLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtPercent(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function fmtClock(now = Date.now()): string {
  const d = new Date(now);
  return d.toLocaleTimeString([], { hour12: false });
}

export function fmtIso(s: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}
