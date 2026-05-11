// Shared types + helpers for the Vercel relay functions. Wire format
// matches the Apps Script side (see internal/protocol/protocol.go) so
// the Go client can dispatch to either backend without translation.

export type Envelope = {
  k?: string;
  u?: string;
  m?: string;
  h?: Record<string, string>;
  b?: string;
  ct?: string;
  r?: boolean;
  q?: Envelope[];
};

export type Reply = {
  s?: number;
  h?: Record<string, string | string[]>;
  c?: string[];
  b?: string;
  e?: string;
  size?: number;
};

// MAX_BODY_BYTES caps the upstream response we will materialize before
// the function streams it back. Anything bigger triggers an
// {e:"too_large"} envelope that the Go side turns into a chunked Range
// download. Tunable via the MAX_BODY_BYTES env var on the deployment.
export function maxBodyBytes(): number {
  const v = Number(process.env.MAX_BODY_BYTES || "");
  if (!Number.isFinite(v) || v <= 0) return 25 * 1024 * 1024;
  return Math.floor(v);
}

// Headers we never forward to the upstream (hop-by-hop or rewritten by
// the runtime). Mirrors the Go-side StripHeaders set.
const HOP_HEADERS = new Set([
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
  "via",
  "proxy-authorization",
  "proxy-connection",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
  "x-relay-token",
]);

export function buildOutboundHeaders(env: Envelope): Headers {
  const h = new Headers();
  if (env.h) {
    for (const [k, v] of Object.entries(env.h)) {
      if (HOP_HEADERS.has(k.toLowerCase())) continue;
      if (typeof v === "string") h.set(k, v);
    }
  }
  if (env.b && !h.has("content-type")) {
    h.set("content-type", env.ct || "application/octet-stream");
  }
  return h;
}

export function decodeBody(env: Envelope): Uint8Array | undefined {
  if (!env.b) return undefined;
  // atob is available in the Node 18+ Vercel runtime via globalThis.
  const raw = atob(env.b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function encodeBody(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  // chunk to keep the call stack happy on big responses
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
  }
  return btoa(s);
}

// collectHeaders flattens fetch Headers into the Reply.h map. Set-Cookie
// is split out into Reply.c since the Go side has dedicated handling for
// the multi-value form (see protocol.ResponseFromReply).
export function collectHeaders(headers: Headers): { h: Record<string, string | string[]>; c: string[] } {
  const h: Record<string, string | string[]> = {};
  const c: string[] = [];
  // headers.getSetCookie() exists in the Node 18+ runtime.
  const getSet = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSet === "function") {
    for (const sc of getSet.call(headers)) c.push(sc);
  }
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return; // already in c
    h[key] = value;
  });
  return { h, c };
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ e: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function isAuthorized(req: Request): boolean {
  const expected = process.env.RELAY_TOKEN;
  if (!expected) return false;
  const got = req.headers.get("x-relay-token") || "";
  return safeEqual(got, expected);
}

// safeEqual is a constant-time string comparison; small but worth doing
// when the only check between strangers and your egress is this header.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function tooLargeReply(size: number, h: Record<string, string | string[]>): Reply {
  return { e: "too_large", size, h };
}

// runEnvelope performs a single envelope's upstream fetch and returns
// the wire Reply. Shared by tunnel.ts (single) and batch.ts (fan-in).
export async function runEnvelope(env: Envelope): Promise<Reply> {
  if (!env.u || !env.m) {
    return { e: "bad_envelope" };
  }
  const init: RequestInit = {
    method: env.m,
    headers: buildOutboundHeaders(env),
    body: decodeBody(env),
    redirect: env.r ? "follow" : "manual",
  };
  let resp: Response;
  try {
    resp = await fetch(env.u, init);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { e: "fetch_failed: " + msg };
  }

  const max = maxBodyBytes();
  const cl = Number(resp.headers.get("content-length") || "");
  const { h, c } = collectHeaders(resp.headers);
  if (Number.isFinite(cl) && cl > max) {
    return tooLargeReply(cl, h);
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength > max) {
    return tooLargeReply(buf.byteLength, h);
  }
  return {
    s: resp.status,
    h,
    c,
    b: encodeBody(buf),
  };
}
