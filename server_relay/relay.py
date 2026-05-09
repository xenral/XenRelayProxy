#!/usr/bin/env python3
"""
Lightweight fetch-relay for MasterHttpRelayVPN.

Runs on your V2Ray server alongside X-UI. Apps Script sends requests
here instead of fetching targets directly, so target websites see
this server's IP instead of Google's.

Usage:
    python3 relay.py                          # default port 9443
    python3 relay.py --port 9443
    RELAY_AUTH_KEY=yourkey python3 relay.py    # override auth key

The AUTH_KEY must match the RELAY_KEY in your Code.gs.

Protocol: same JSON as Code.gs uses internally:
    POST /relay
    Body: {"k":"auth","u":"https://target.com","m":"GET","h":{...},"b":"base64"}
    Response: {"s":200,"h":{...},"b":"base64-body"}
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import ssl
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

AUTH_KEY = os.environ.get("RELAY_AUTH_KEY", "CHANGE_ME_RELAY_SECRET")

# Inbound POST body cap (Apps Script -> relay).
MAX_REQUEST_BODY = 50 * 1024 * 1024  # 50 MB

# Outbound response body cap. Apps Script's ContentService output is capped
# at ~50 MB; base64 inflates ~4/3, plus JSON envelope overhead. 20 MB raw
# leaves comfortable headroom. If the upstream body exceeds this, we emit
# a structured "too_large" signal so the client can retry as Range chunks.
RAW_BODY_CAP = 20 * 1024 * 1024  # 20 MB

# Headers to strip from outbound requests (same as Code.gs SKIP_HEADERS)
SKIP_HEADERS = frozenset({
    "host", "connection", "content-length", "transfer-encoding",
    "proxy-connection", "proxy-authorization", "priority", "te",
    "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
    "x-forwarded-port", "x-real-ip", "forwarded", "via",
})


def _content_length(h: dict) -> int | None:
    """Case-insensitive Content-Length lookup. Returns None if absent or unparseable."""
    for k, v in h.items():
        if k.lower() == "content-length":
            try:
                return int(str(v).strip())
            except (TypeError, ValueError):
                return None
    return None


class RelayHandler(BaseHTTPRequestHandler):
    """Handle POST /relay — fetch a URL and return the response."""

    # Suppress default stderr logging per request
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[relay] {fmt % args}\n")

    def do_POST(self):
        if self.path != "/relay":
            self._error(404, "not found")
            return

        # Read body
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            self._error(400, "bad content-length")
            return
        if length > MAX_REQUEST_BODY:
            self._error(413, "body too large")
            return

        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            self._error(400, "invalid json")
            return

        # Auth
        if data.get("k") != AUTH_KEY:
            self._error(403, "unauthorized")
            return

        url = data.get("u", "")
        if not url or not url.startswith(("http://", "https://")):
            self._json({"e": "bad url"})
            return

        method = str(data.get("m", "GET")).upper()

        # Build request
        req = Request(url, method=method)

        # Headers
        headers = data.get("h", {})
        if isinstance(headers, dict):
            for k, v in headers.items():
                if k.lower() not in SKIP_HEADERS:
                    req.add_header(k, v)

        # Body
        req_body = None
        if data.get("b"):
            try:
                req_body = base64.b64decode(data["b"])
            except Exception:
                self._json({"e": "bad base64 body"})
                return
            if data.get("ct"):
                req.add_header("Content-Type", data["ct"])

        # Fetch
        try:
            # Don't verify upstream certs (same as muteHttpExceptions)
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            resp = urlopen(req, data=req_body, timeout=25, context=ctx)
            status = resp.status
            resp_headers = dict(resp.headers)

            # Guard 1: declared Content-Length over the cap → don't read.
            declared = _content_length(resp_headers)
            if declared is not None and declared > RAW_BODY_CAP:
                resp_headers["X-Relayed-Via"] = "dc.kavados.com"
                self._json({
                    "e": "too_large",
                    "size": declared,
                    "h": resp_headers,
                })
                return

            # Guard 2: read at most CAP+1 to detect overflow without
            # buffering more than necessary.
            body = resp.read(RAW_BODY_CAP + 1)
            if len(body) > RAW_BODY_CAP:
                resp_headers["X-Relayed-Via"] = "dc.kavados.com"
                self._json({
                    "e": "too_large",
                    "size": declared if declared is not None else -1,
                    "h": resp_headers,
                })
                return

        except HTTPError as e:
            status = e.code
            resp_headers = dict(e.headers) if e.headers else {}
            declared = _content_length(resp_headers)
            if declared is not None and declared > RAW_BODY_CAP:
                resp_headers["X-Relayed-Via"] = "dc.kavados.com"
                self._json({
                    "e": "too_large",
                    "size": declared,
                    "h": resp_headers,
                })
                return
            try:
                body = e.read(RAW_BODY_CAP + 1)
            except Exception:
                body = b""
            if len(body) > RAW_BODY_CAP:
                resp_headers["X-Relayed-Via"] = "dc.kavados.com"
                self._json({
                    "e": "too_large",
                    "size": declared if declared is not None else -1,
                    "h": resp_headers,
                })
                return

        except URLError as e:
            self._json({"e": f"fetch error: {e.reason}"})
            return

        except Exception as e:
            self._json({"e": f"fetch error: {e}"})
            return

        # Tag the response so the client can verify relay is active
        resp_headers["X-Relayed-Via"] = "dc.kavados.com"

        # Return response in the same format as Code.gs
        self._json({
            "s": status,
            "h": resp_headers,
            "b": base64.b64encode(body).decode("ascii"),
        })

    def do_GET(self):
        """Health check."""
        self._json({"status": "ok", "service": "relay"})

    def _json(self, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, msg: str) -> None:
        body = json.dumps({"e": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadedHTTPServer(HTTPServer):
    """Handle each request in a separate thread — no queuing."""
    from socketserver import ThreadingMixIn
    # Mix in threading so concurrent requests from multiple deployments
    # (or fetchAll batches) are handled in parallel.
    allow_reuse_address = True
    daemon_threads = True

    def process_request(self, request, client_address):
        import threading
        t = threading.Thread(target=self.process_request_thread,
                             args=(request, client_address))
        t.daemon = True
        t.start()

    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


def main():
    parser = argparse.ArgumentParser(description="Fetch relay for Apps Script")
    parser.add_argument("--port", type=int, default=9443, help="Listen port")
    parser.add_argument("--host", default="0.0.0.0", help="Listen address")
    args = parser.parse_args()

    if AUTH_KEY == "CHANGE_ME_RELAY_SECRET":
        print("WARNING: Using default AUTH_KEY. Set RELAY_AUTH_KEY env var!")

    server = ThreadedHTTPServer((args.host, args.port), RelayHandler)
    print(f"Relay listening on {args.host}:{args.port} (threaded)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")


if __name__ == "__main__":
    main()
