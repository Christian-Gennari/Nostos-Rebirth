"""Shared pytest fixtures for the Nostos reading connector package."""

from __future__ import annotations

import sys
from pathlib import Path

# Make `nostos_reading_connector` importable regardless of the invocation
# directory (pytest only inserts the tests dir itself).
_PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

import threading  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

import pytest  # noqa: E402


class _GatewayHandler(BaseHTTPRequestHandler):
    """Records requests and replays canned responses (status, body, type)."""

    requests: list = []
    request_headers: list = []
    response_queue: list = []
    sleep: float = 0.0

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        self._handle()

    def do_POST(self):  # noqa: N802
        self._handle()

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        type(self).requests.append((self.command, self.path, body))
        type(self).request_headers.append(dict(self.headers))
        if type(self).sleep:
            import time

            time.sleep(type(self).sleep)
        if not type(self).response_queue:
            self.send_response(500)
            self.end_headers()
            return
        item = type(self).response_queue.pop(0)
        status, payload, content_type = item[:3]
        extra_headers = item[3] if len(item) > 3 else {}
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type or "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        for name, value in extra_headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A002, D102
        pass


@pytest.fixture
def gateway_server():
    """A real local HTTP server; yields its base URL string.

    ``_GatewayHandler.response_queue`` queues ``(status, body, content_type)``
    tuples served in order; ``_GatewayHandler.requests`` records every
    ``(method, path, body_bytes)``. Both are reset per test.
    """
    _GatewayHandler.requests = []
    _GatewayHandler.request_headers = []
    _GatewayHandler.response_queue = []
    _GatewayHandler.sleep = 0.0
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _GatewayHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


@pytest.fixture
def recorded_requests():
    """Convenience accessor for the handler's recorded requests."""
    return _GatewayHandler.requests
