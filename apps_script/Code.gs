/**
 * XenRelayProxy Apps Script Relay - protocol v2.
 *
 * Redeploy this file whenever migrating from the Python relay. v2 intentionally
 * uses {r:[...]} for batch responses and does not preserve the older {q:[...]}
 * response shape.
 */

const AUTH_KEY = "OgXHFEFjk/ApnnpXJbsEwMwlOHDhmhmNihRIEH8077k=";

// Optional server-side hop. Leave empty for direct UrlFetchApp.fetch.
const RELAY_URL = "";
const RELAY_KEY = "";

const SKIP_HEADERS = {
  host: 1, connection: 1, "content-length": 1,
  "transfer-encoding": 1, "proxy-connection": 1, "proxy-authorization": 1,
  priority: 1, te: 1,
  "x-forwarded-for": 1, "x-forwarded-host": 1, "x-forwarded-proto": 1,
  "x-forwarded-port": 1, "x-real-ip": 1, forwarded: 1, via: 1
};

const SAFE_REPLAY_METHODS = { GET: 1, HEAD: 1, OPTIONS: 1 };

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || "{}");
    if (req.k !== AUTH_KEY) return _json({ e: "unauthorized" });
    if (Array.isArray(req.q)) return _doBatch(req.q);
    return _doSingle(req);
  } catch (err) {
    return _json({ e: String(err) });
  }
}

function _doSingle(req) {
  const err = _validateItem(req);
  if (err) return _json({ e: err });
  if (RELAY_URL) return _doRelayed(req);

  const opts = _buildOpts(req);
  const resp = UrlFetchApp.fetch(req.u, opts);
  return _json(_reply(resp, opts, req));
}

function _doBatch(items) {
  if (RELAY_URL) return _doBatchRelayed(items);

  const fetchArgs = [];
  const fetchIndex = [];
  const fetchMethods = [];
  const errorMap = {};

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const err = _validateItem(item);
    if (err) {
      errorMap[i] = err;
      continue;
    }
    try {
      const opts = _buildOpts(item);
      opts.url = item.u;
      fetchArgs.push(opts);
      fetchIndex.push(i);
      fetchMethods.push(String(item.m || "GET").toUpperCase());
    } catch (err) {
      errorMap[i] = String(err);
    }
  }

  let responses = [];
  if (fetchArgs.length > 0) {
    try {
      responses = UrlFetchApp.fetchAll(fetchArgs);
    } catch (err) {
      responses = [];
      for (let j = 0; j < fetchArgs.length; j++) {
        try {
          if (!SAFE_REPLAY_METHODS[fetchMethods[j]]) {
            errorMap[fetchIndex[j]] = "batch fetchAll failed; unsafe method not replayed";
            responses[j] = null;
            continue;
          }
          const fallbackReq = fetchArgs[j];
          const fallbackUrl = fallbackReq.url;
          const fallbackOpts = {};
          for (const key in fallbackReq) {
            if (Object.prototype.hasOwnProperty.call(fallbackReq, key) && key !== "url") {
              fallbackOpts[key] = fallbackReq[key];
            }
          }
          responses[j] = UrlFetchApp.fetch(fallbackUrl, fallbackOpts);
        } catch (singleErr) {
          errorMap[fetchIndex[j]] = String(singleErr);
          responses[j] = null;
        }
      }
    }
  }

  const results = [];
  let rIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (Object.prototype.hasOwnProperty.call(errorMap, i)) {
      results.push({ e: errorMap[i] });
      continue;
    }
    const resp = responses[rIdx++];
    results.push(resp ? _reply(resp, fetchArgs[rIdx - 1], items[i]) : { e: "fetch failed" });
  }
  return _json({ r: results });
}

function _doRelayed(req) {
  const relayPayload = _relayPayload(req);
  const resp = UrlFetchApp.fetch(RELAY_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(relayPayload),
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: false
  });
  try {
    var parsed = JSON.parse(resp.getContentText());
    return _json(_enrichRelayReply(parsed, req));
  } catch (err) {
    return _json({ e: "relay parse error: " + resp.getContentText().substring(0, 200) });
  }
}

function _doBatchRelayed(items) {
  const fetchArgs = [];
  const fetchIndex = [];
  const errorMap = {};

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const err = _validateItem(item);
    if (err) {
      errorMap[i] = err;
      continue;
    }
    fetchArgs.push({
      url: RELAY_URL,
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(_relayPayload(item)),
      muteHttpExceptions: true,
      validateHttpsCertificates: false
    });
    fetchIndex.push(i);
  }

  let responses = [];
  if (fetchArgs.length > 0) {
    try {
      responses = UrlFetchApp.fetchAll(fetchArgs);
    } catch (err) {
      responses = [];
      for (let j = 0; j < fetchArgs.length; j++) {
        try {
          responses[j] = UrlFetchApp.fetch(fetchArgs[j].url, fetchArgs[j]);
        } catch (singleErr) {
          errorMap[fetchIndex[j]] = String(singleErr);
          responses[j] = null;
        }
      }
    }
  }

  const results = [];
  let rIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (Object.prototype.hasOwnProperty.call(errorMap, i)) {
      results.push({ e: errorMap[i] });
      continue;
    }
    const resp = responses[rIdx++];
    if (!resp) {
      results.push({ e: "relay fetch failed" });
      continue;
    }
    try {
      results.push(_enrichRelayReply(JSON.parse(resp.getContentText()), items[i]));
    } catch (parseErr) {
      results.push({ e: "relay parse error" });
    }
  }
  return _json({ r: results });
}

// _enrichRelayReply post-processes a reply received from the external
// relay server (RELAY_URL) to add cookie handling that the relay server
// may not provide:
//   - Splits comma-joined Set-Cookie headers in the `h` map
//   - Populates the `c` field (v2.1 explicit Set-Cookie array)
//   - Populates the `d` field (debug counters)
// This ensures the Go proxy receives the same enriched format regardless
// of whether the request was handled locally or via an external relay.
function _enrichRelayReply(reply, req) {
  if (!reply || reply.e || !reply.h) return reply;

  // Extract and normalize Set-Cookie from the relay's header map.
  var setCookieArr = [];
  for (var k in reply.h) {
    if (!Object.prototype.hasOwnProperty.call(reply.h, k)) continue;
    if (k.toLowerCase() === "set-cookie") {
      var v = reply.h[k];
      var split = _splitSetCookie(v);
      reply.h[k] = split; // normalize in-place for the H map too
      setCookieArr = setCookieArr.concat(split);
    }
  }

  // Populate the v2.1 `c` field if not already present.
  if (!reply.c && setCookieArr.length > 0) {
    reply.c = setCookieArr;
  }

  // Populate debug counters if not already present.
  if (!reply.d) {
    var hk = 0;
    for (var hkey in reply.h) {
      if (Object.prototype.hasOwnProperty.call(reply.h, hkey)) hk++;
    }
    var cl = 0, ck = false;
    if (req && req.h) {
      for (var rk in req.h) {
        if (Object.prototype.hasOwnProperty.call(req.h, rk) && rk.toLowerCase() === "cookie") {
          ck = true;
          cl = String(req.h[rk]).length;
          break;
        }
      }
    }
    reply.d = {
      sc: setCookieArr.length,
      hk: hk,
      cl: cl,
      ck: ck
    };
  }
  return reply;
}

function _buildOpts(req) {
  const opts = {
    method: String(req.m || "GET").toLowerCase(),
    muteHttpExceptions: true,
    followRedirects: req.r !== false,
    validateHttpsCertificates: true,
    escaping: false
  };
  if (req.h && typeof req.h === "object") {
    const headers = {};
    for (const k in req.h) {
      if (Object.prototype.hasOwnProperty.call(req.h, k) && !SKIP_HEADERS[k.toLowerCase()]) {
        headers[k] = String(req.h[k]);
      }
    }
    opts.headers = headers;
  }
  if (req.b) {
    opts.payload = Utilities.base64Decode(req.b);
    if (req.ct) opts.contentType = req.ct;
  }
  return opts;
}

function _relayPayload(req) {
  const payload = { k: RELAY_KEY, u: req.u, m: req.m || "GET" };
  if (req.h) {
    payload.h = {};
    for (const k in req.h) {
      if (Object.prototype.hasOwnProperty.call(req.h, k) && !SKIP_HEADERS[k.toLowerCase()]) {
        payload.h[k] = req.h[k];
      }
    }
  }
  if (req.b) payload.b = req.b;
  if (req.ct) payload.ct = req.ct;
  if (req.r === false) payload.r = false;
  return payload;
}

function _reply(resp, opts, req) {
  var headers = _respHeaders(resp);

  // Extract Set-Cookie into a dedicated array (protocol v2.1 "c" field).
  // This bypasses all header-map casing/typing issues for the one header
  // that matters most for authentication flows.
  var setCookieArr = [];
  for (var k in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === "set-cookie") {
      var v = headers[k];
      if (Array.isArray(v)) {
        setCookieArr = setCookieArr.concat(v);
      } else if (v != null) {
        setCookieArr = setCookieArr.concat(_splitSetCookie(v));
      }
    }
  }

  // _dbg surfaces what Apps Script *actually* sent and saw, so the Go
  // side can tell the difference between (a) protocol-decoder cookie
  // loss and (b) the upstream simply not returning any cookies.
  // Naming kept short to fit Apps Script's response size budget.
  var dbg = {
    sc: setCookieArr.length,
    hk: 0,
    cl: 0,    // length of the Cookie header WE sent to the upstream
    ck: false // did we send a Cookie header at all?
  };
  for (var hk in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, hk)) dbg.hk++;
  }
  if (opts && opts.headers) {
    for (var sk in opts.headers) {
      if (Object.prototype.hasOwnProperty.call(opts.headers, sk) && sk.toLowerCase() === "cookie") {
        dbg.ck = true;
        dbg.cl = String(opts.headers[sk]).length;
        break;
      }
    }
  }
  return {
    s: resp.getResponseCode(),
    h: headers,
    c: setCookieArr.length > 0 ? setCookieArr : undefined, // v2.1: explicit Set-Cookie array
    b: Utilities.base64Encode(resp.getContent()),
    d: dbg
  };
}

// _respHeaders returns response headers normalized so the Go client can
// decode them deterministically:
//   - Multi-valued headers (notably Set-Cookie) are always arrays.
//   - Single-valued headers stay strings.
//
// Uses a dual-path strategy: calls BOTH getAllHeaders() and getHeaders(),
// extracts Set-Cookie from each, and takes whichever produced MORE
// cookies. This guards against getAllHeaders() silently dropping
// Set-Cookie (observed in some V8 runtime versions) while still
// benefiting from its proper array support when it works.
//
// For non-Set-Cookie headers, getAllHeaders() is preferred since it
// preserves multi-valued headers as arrays.
function _respHeaders(resp) {
  var allH = null, flatH = null;
  try {
    if (typeof resp.getAllHeaders === "function") {
      allH = resp.getAllHeaders();
    }
  } catch (e) { /* fall through */ }
  try {
    flatH = resp.getHeaders();
  } catch (e) { /* fall through */ }

  var source = allH || flatH;
  if (!source) return {};

  var out = {};
  for (var k in source) {
    if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
    var v = source[k];
    if (k.toLowerCase() === "set-cookie") {
      // Dual-path: extract from both sources, take the one with more cookies.
      // Cookie loss is strictly worse than duplication (browser de-duplicates
      // by name+domain+path).
      var fromAll = allH ? _splitSetCookie(allH[k]) : [];
      var fromFlat = flatH ? _splitSetCookie(flatH[k]) : [];
      out[k] = fromAll.length >= fromFlat.length ? fromAll : fromFlat;
    } else {
      out[k] = v;
    }
  }
  // If source lacked a Set-Cookie key, check the other source too.
  // getAllHeaders() may use different casing than getHeaders().
  var other = (source === allH) ? flatH : allH;
  if (other) {
    for (var ok in other) {
      if (!Object.prototype.hasOwnProperty.call(other, ok)) continue;
      if (ok.toLowerCase() === "set-cookie") {
        var existing = [];
        for (var ek in out) {
          if (Object.prototype.hasOwnProperty.call(out, ek) && ek.toLowerCase() === "set-cookie") {
            existing = out[ek];
            break;
          }
        }
        var fromOther = _splitSetCookie(other[ok]);
        if (fromOther.length > (Array.isArray(existing) ? existing.length : 0)) {
          out[ok] = fromOther;
        }
      }
    }
  }
  return out;
}

// _splitSetCookie normalizes Set-Cookie into an array of individual
// cookie strings, regardless of the input shape. Handles:
//   - already an array → returned as-is
//   - single string with one cookie → wrapped in [string]
//   - single string with comma-joined cookies → split intelligently
//     so the comma inside `Expires=Mon, 01 Jan 2030 ...` is preserved.
//
// The heuristic: split on commas only when followed by a token=value
// pattern where the token is NOT a known Set-Cookie attribute (Expires,
// Max-Age, Path, Domain, SameSite, etc.). This prevents false splits on
// `Expires=Mon, 01 Jan 2030 00:00:00 GMT` and similar date strings.

var COOKIE_ATTRS = {
  "expires":1, "max-age":1, "path":1, "domain":1,
  "samesite":1, "secure":1, "httponly":1, "partitioned":1
};

function _splitSetCookie(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map(function (x) { return String(x); });
  }
  var s = String(v);
  // Split on ", " only when followed by a token that looks like a
  // new cookie (`name=...`) and NOT a known cookie attribute.
  var parts = [];
  var idx = 0;
  while (idx < s.length) {
    // Find the next "comma followed by likely cookie boundary".
    var nextComma = -1;
    var probe = idx;
    while (true) {
      var c = s.indexOf(",", probe);
      if (c < 0) break;
      // After the comma, skip whitespace.
      var p = c + 1;
      while (p < s.length && s.charAt(p) === " ") p++;
      // Look for `name=` where name has no spaces.
      var eq = s.indexOf("=", p);
      if (eq > p) {
        var name = s.substring(p, eq);
        if (!/[\s,;]/.test(name)) {
          // If the name is a known Set-Cookie attribute, this comma is
          // inside the cookie (e.g. Expires date) — not a boundary.
          if (COOKIE_ATTRS[name.toLowerCase()]) {
            probe = c + 1;
            continue;
          }
          nextComma = c;
          break;
        }
      }
      probe = c + 1;
    }
    if (nextComma < 0) {
      parts.push(s.substring(idx).replace(/^\s+|\s+$/g, ""));
      break;
    }
    parts.push(s.substring(idx, nextComma).replace(/^\s+|\s+$/g, ""));
    idx = nextComma + 1;
  }
  return parts.filter(function (x) { return x.length > 0; });
}

function _validateItem(req) {
  if (!req || typeof req !== "object") return "bad item";
  if (!req.u || typeof req.u !== "string" || !req.u.match(/^https?:\/\//i)) return "bad url";
  return "";
}

function doGet() {
  return HtmlService.createHtmlOutput(
    "<!doctype html><html><head><title>XenRelayProxy</title></head>" +
      "<body style=\"font-family:sans-serif;max-width:640px;margin:40px auto\">" +
      "<h1>XenRelayProxy relay is running</h1>" +
      "<p>This Apps Script deployment accepts protocol v2 relay requests.</p>" +
      "</body></html>"
  );
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

