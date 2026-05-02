/**
 * XenRelayProxy Apps Script Relay - protocol v2.
 *
 * Redeploy this file whenever migrating from the Python relay. v2 intentionally
 * uses {r:[...]} for batch responses and does not preserve the older {q:[...]}
 * response shape.
 */

const AUTH_KEY = "CHANGE_ME_TO_A_STRONG_SECRET";

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
  return _json(_reply(resp));
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
    results.push(resp ? _reply(resp) : { e: "fetch failed" });
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
    return _json(JSON.parse(resp.getContentText()));
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
      results.push(JSON.parse(resp.getContentText()));
    } catch (parseErr) {
      results.push({ e: "relay parse error" });
    }
  }
  return _json({ r: results });
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

function _reply(resp) {
  return {
    s: resp.getResponseCode(),
    h: _respHeaders(resp),
    b: Utilities.base64Encode(resp.getContent())
  };
}

function _respHeaders(resp) {
  try {
    if (typeof resp.getAllHeaders === "function") return resp.getAllHeaders();
  } catch (err) {}
  return resp.getHeaders();
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

