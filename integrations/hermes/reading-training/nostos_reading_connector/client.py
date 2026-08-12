"""Stateless HTTP client for the Nostos reading gateway and REST surface.

Thin optional connector client (Task 10B1), stdlib-only (``urllib``). It
scopes transport only:

* ``dispatch`` — POST the exact ``/api/reading/gateway/dispatch`` JSON
  ``{clientId, idempotencyKey, text}``, forwarding the Python string
  byte-exactly (no trimming, no encoding surprises).
* ``get_inbox`` — GET ``/api/reading-training/inbox`` with typed capture
  parsing.
* ``lease_notifications`` / ``ack_notification`` — bounded optional wrappers
  for the notification outbox (no Telegram sending, no auto-ack; the caller
  must acknowledge only after confirmed delivery).

Contract rules:

* No domain-state caching, no retries, no idempotency-key generation, no
  fallback state. Exactly one HTTP attempt per call.
* Non-2xx responses carrying the stable ``ReadingCommandResultDto`` envelope
  (``{reply, data, stateVersion, duplicate}``) are returned as typed domain
  results — the status code is preserved on the result.
* Redirects are never followed: any 3xx surfaces as
  :class:`NostosProtocolError` after exactly one request (a redirect body is
  never parsed as an envelope, and ``Location`` is never contacted). URLs
  carrying userinfo (``user:pass@host``) are rejected at construction.
* Transport failures (connection refused, timeout, DNS) raise
  :class:`NostosUnavailableError`; malformed/unexpected responses raise
  :class:`NostosProtocolError`. Error messages never include request bodies,
  response bodies, headers, or URL credentials — only the scheme/host/port.
"""

from __future__ import annotations

import http.client
import json
import math
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional, Union

DEFAULT_BASE_URL = "http://127.0.0.1:5214"
DEFAULT_TIMEOUT = 5.0
"""Finite default request timeout in seconds."""

DISPATCH_PATH = "/api/reading/gateway/dispatch"
INBOX_PATH = "/api/reading-training/inbox"
NOTIFICATIONS_LEASE_PATH = "/api/reading-training/notifications/lease"
NOTIFICATIONS_ACK_PATH = "/api/reading-training/notifications/{notification_id}/ack"

_JSON_HEADERS = {"Accept": "application/json"}
_JSON_POST_HEADERS = {"Accept": "application/json", "Content-Type": "application/json; charset=utf-8"}


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: a 3xx is a protocol error, not a detour.

    ``redirect_request`` raising inside urllib's error machinery aborts the
    one in-flight request immediately — ``Location`` is never contacted and
    the redirect body is never parsed as an envelope. The message is built
    by the owning client (origin only, no headers/body/credentials).
    """

    def __init__(self, msg_fn) -> None:
        super().__init__()
        self._msg_fn = msg_fn

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise NostosProtocolError(
            self._msg_fn(f"unexpected redirect (HTTP {code}); redirects are not followed")
        )


class NostosClientError(Exception):
    """Base class for all client errors."""


class NostosUnavailableError(NostosClientError):
    """Nostos could not be reached (connection failure, DNS, or timeout)."""


class NostosProtocolError(NostosClientError):
    """Nostos responded with an unexpected or unparseable payload."""


@dataclass(frozen=True)
class CommandResult:
    """Stable parsed gateway envelope — success or domain error, any status.

    ``error_code`` is the domain error code (``data.code``) when the payload
    carries one (e.g. ``gateway_ignored``, ``not_initialized``); otherwise
    ``None``. ``http_status`` is the raw status so callers can distinguish
    e.g. a 409 ``already_active`` from a 422 ``gateway_ignored``.
    """

    reply: str
    data: Any
    state_version: str
    duplicate: bool
    http_status: int
    error_code: Optional[str] = None

    @property
    def is_error(self) -> bool:
        return self.error_code is not None


@dataclass(frozen=True)
class ReadingCapture:
    """Typed ``ReadingCaptureDto``. ``type`` is the numeric wire enum:
    ``0`` Thought, ``1`` Question, ``2`` Bookmark."""

    id: str
    text: str
    type: int
    book_id: str
    session_id: Optional[str]
    external_id: Optional[str]
    resolved: bool
    promoted_note_id: Optional[str]
    created_at: str


@dataclass(frozen=True)
class InboxResult:
    """Parsed inbox envelope: stable fields plus typed captures.

    On a domain error (e.g. ``not_initialized``) ``error_code`` is set and
    ``captures`` is empty.
    """

    reply: str
    state_version: str
    duplicate: bool
    http_status: int
    error_code: Optional[str]
    captures: tuple = ()

    @property
    def is_error(self) -> bool:
        return self.error_code is not None


@dataclass(frozen=True)
class LeasedNotification:
    """One claimed outbox item. ``payload`` is the opaque typed payload dict
    (e.g. ``target-reached``); parsing it is the caller's concern."""

    notification_id: str
    payload: Optional[dict]
    lease_until: str


@dataclass(frozen=True)
class AckResult:
    notification_id: str
    acknowledged: bool


class NostosClient:
    """Stateless, stdlib-only HTTP client for the Nostos reading surface."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        if not isinstance(base_url, str) or not base_url.strip():
            raise ValueError("base_url must be a non-empty string")
        parts = urllib.parse.urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError("base_url must be an http(s) origin, e.g. http://127.0.0.1:5214")
        if parts.username is not None or parts.password is not None:
            raise ValueError("base_url must not include userinfo (user:pass@)")
        if parts.path not in ("", "/"):
            raise ValueError("base_url must not include a path")
        if parts.query or parts.fragment:
            raise ValueError("base_url must not include a query or fragment")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
            raise ValueError("timeout must be a number")
        if not math.isfinite(float(timeout)) or float(timeout) <= 0:
            raise ValueError("timeout must be a finite positive number")
        self._base_url = base_url.rstrip("/")
        self._timeout = float(timeout)
        # Custom opener: redirects (301/302/303/307/308) raise a typed
        # protocol error from the handler instead of being followed.
        self._opener = urllib.request.build_opener(
            _NoRedirectHandler(self._msg),
        )

    # ------------------------------------------------------------------ API

    def dispatch(self, client_id: str, idempotency_key: str, text: str) -> CommandResult:
        """Forward one raw message to the gateway, byte-exactly.

        ``client_id`` must be the configured connector identity and
        ``idempotency_key`` a stable key derived from the trusted platform
        message id (see ``routing.idempotency_key``) — this client never
        generates keys. Raises ``ValueError`` for empty identity fields and
        ``TypeError`` for a non-string ``text``.
        """
        if not isinstance(client_id, str) or not client_id:
            raise ValueError("client_id must be a non-empty string")
        if not isinstance(idempotency_key, str) or not idempotency_key:
            raise ValueError("idempotency_key must be a non-empty string")
        if not isinstance(text, str):
            raise TypeError("text must be a string")
        body = json.dumps(
            {"clientId": client_id, "idempotencyKey": idempotency_key, "text": text},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        status, payload = self._request("POST", DISPATCH_PATH, body=body)
        reply, data, version, duplicate, error_code = self._parse_envelope(status, payload)
        return CommandResult(reply, data, version, duplicate, status, error_code)

    def get_inbox(self) -> InboxResult:
        """Fetch the unresolved captures inbox as typed captures."""
        status, payload = self._request("GET", INBOX_PATH)
        reply, data, version, duplicate, error_code = self._parse_envelope(status, payload)
        if error_code is not None:
            return InboxResult(reply, version, duplicate, status, error_code, ())
        return InboxResult(reply, version, duplicate, status, None, self._parse_captures(data))

    def lease_notifications(
        self, max_count: int = 10, lease_seconds: int = 60
    ) -> tuple:
        """Claim due outbox notifications (bounded wrapper, no sending).

        ``max_count`` 1..100, ``lease_seconds`` 1..3600 (server contract).
        The response is a plain list (not a command envelope); a non-2xx
        response raises :class:`NostosProtocolError`.
        """
        if isinstance(max_count, bool) or not isinstance(max_count, int) or not 1 <= max_count <= 100:
            raise ValueError("max_count must be an int in 1..100")
        if isinstance(lease_seconds, bool) or not isinstance(lease_seconds, int) or not 1 <= lease_seconds <= 3600:
            raise ValueError("lease_seconds must be an int in 1..3600")
        status, payload = self._request(
            "GET",
            NOTIFICATIONS_LEASE_PATH,
            query={"maxCount": max_count, "leaseSeconds": lease_seconds},
        )
        if not 200 <= status < 300:
            raise NostosProtocolError(self._msg(f"lease returned HTTP {status}; expected 2xx"))
        if payload is None:
            return ()
        if not isinstance(payload, list):
            raise NostosProtocolError(self._msg("lease response is not a list"))
        claimed = []
        for index, item in enumerate(payload):
            if not isinstance(item, dict):
                raise NostosProtocolError(self._msg(f"lease item[{index}] is not an object"))
            notification_id = item.get("notificationId")
            lease_until = item.get("leaseUntil")
            leased_payload = item.get("payload")
            if not isinstance(notification_id, str) or not isinstance(lease_until, str):
                raise NostosProtocolError(
                    self._msg(f"lease item[{index}] missing string notificationId/leaseUntil")
                )
            if leased_payload is not None and not isinstance(leased_payload, dict):
                raise NostosProtocolError(self._msg(f"lease item[{index}] payload is not an object"))
            claimed.append(LeasedNotification(notification_id, leased_payload, lease_until))
        return tuple(claimed)

    def ack_notification(self, notification_id: str) -> AckResult:
        """Acknowledge one leased notification (no body, idempotent server-side).

        The caller must ack only ids returned by :meth:`lease_notifications`
        and only after confirmed delivery. Unknown ids surface as
        :class:`NostosProtocolError` (the ack endpoint answers ProblemDetails,
        not a command envelope).
        """
        if not isinstance(notification_id, str) or not notification_id:
            raise ValueError("notification_id must be a non-empty string")
        path = NOTIFICATIONS_ACK_PATH.format(notification_id=notification_id)
        status, payload = self._request("POST", path)
        if not 200 <= status < 300:
            raise NostosProtocolError(self._msg(f"ack returned HTTP {status}; expected 200"))
        if not isinstance(payload, dict):
            raise NostosProtocolError(self._msg("ack response is not an object"))
        acked_id = payload.get("notificationId")
        acknowledged = payload.get("acknowledged")
        if not isinstance(acked_id, str) or not isinstance(acknowledged, bool):
            raise NostosProtocolError(self._msg("ack response missing notificationId/acknowledged"))
        return AckResult(acked_id, acknowledged)

    # ------------------------------------------------------------- internals

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[bytes] = None,
        query: Optional[dict] = None,
    ) -> tuple:
        """Exactly one HTTP attempt. Returns ``(status, parsed_json_or_None)``.

        Raises :class:`NostosUnavailableError` for transport failures and
        :class:`NostosProtocolError` for malformed responses. Never retries.
        """
        url = self._base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = _JSON_POST_HEADERS if body is not None else _JSON_HEADERS
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                status = int(response.status)
                raw = response.read()
        except urllib.error.HTTPError as exc:  # non-2xx with a body we must inspect
            status = int(exc.code)
            if 300 <= status < 400:  # redirects never followed, never an envelope
                raise NostosProtocolError(
                    self._msg(
                        f"unexpected redirect (HTTP {status}); redirects are not followed"
                    )
                ) from exc
            raw = exc.read()
        except urllib.error.URLError as exc:
            raise self._availability_error(exc) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise NostosUnavailableError(self._msg("request timed out")) from exc
        except http.client.HTTPException as exc:
            raise NostosProtocolError(self._msg(f"transport error: {exc}")) from exc
        except OSError as exc:
            raise NostosUnavailableError(self._msg(f"connection failed: {exc}")) from exc
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise NostosProtocolError(self._msg("response body is not valid UTF-8")) from exc
        if not text.strip():
            return status, None
        try:
            return status, json.loads(text)
        except json.JSONDecodeError as exc:
            raise NostosProtocolError(self._msg(f"response is not valid JSON: {exc}")) from exc

    def _parse_envelope(self, status: int, payload: Any) -> tuple:
        """``(reply, data, state_version, duplicate, error_code)`` from the
        stable ``ReadingCommandResultDto`` envelope. Any non-envelope payload
        — on any status — raises :class:`NostosProtocolError`."""
        if not isinstance(payload, dict):
            raise NostosProtocolError(
                self._msg(f"expected a command envelope object (HTTP {status})")
            )
        reply = payload.get("reply")
        state_version = payload.get("stateVersion")
        if not isinstance(reply, str) or not isinstance(state_version, str):
            raise NostosProtocolError(
                self._msg(f"envelope missing string reply/stateVersion (HTTP {status})")
            )
        duplicate = payload.get("duplicate", False)
        if not isinstance(duplicate, bool):
            raise NostosProtocolError(
                self._msg(f"envelope duplicate is not a boolean (HTTP {status})")
            )
        data = payload.get("data")
        error_code: Optional[str] = None
        if isinstance(data, dict):
            code = data.get("code")
            if isinstance(code, str):
                error_code = code
        return reply, data, state_version, duplicate, error_code

    def _parse_captures(self, data: Any) -> tuple:
        """Parse the inbox ``data`` list into typed captures (defensive)."""
        if data is None:
            return ()
        if not isinstance(data, list):
            raise NostosProtocolError(self._msg("inbox data is not a list"))
        captures = []
        for index, item in enumerate(data):
            if not isinstance(item, dict):
                raise NostosProtocolError(self._msg(f"inbox item[{index}] is not an object"))
            capture = ReadingCapture(
                id=self._require_str(item, "id", index),
                text=self._require_str(item, "text", index),
                type=self._require_int(item, "type", index),
                book_id=self._require_str(item, "bookId", index),
                session_id=self._optional_str(item, "sessionId", index),
                external_id=self._optional_str(item, "externalId", index),
                resolved=self._optional_bool(item, "resolved", index),
                promoted_note_id=self._optional_str(item, "promotedNoteId", index),
                created_at=self._require_str(item, "createdAt", index),
            )
            captures.append(capture)
        return tuple(captures)

    def _require_str(self, item: dict, key: str, index: int) -> str:
        value = item.get(key)
        if not isinstance(value, str):
            raise NostosProtocolError(self._msg(f"inbox item[{index}].{key} is not a string"))
        return value

    def _require_int(self, item: dict, key: str, index: int) -> int:
        value = item.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            raise NostosProtocolError(self._msg(f"inbox item[{index}].{key} is not an integer"))
        return value

    def _optional_str(self, item: dict, key: str, index: int) -> Optional[str]:
        value = item.get(key)
        if value is None:
            return None
        if not isinstance(value, str):
            raise NostosProtocolError(self._msg(f"inbox item[{index}].{key} is not a string"))
        return value

    def _optional_bool(self, item: dict, key: str, index: int) -> bool:
        value = item.get(key)
        if value is None:
            return False
        if not isinstance(value, bool):
            raise NostosProtocolError(self._msg(f"inbox item[{index}].{key} is not a boolean"))
        return value

    def _availability_error(self, exc: urllib.error.URLError) -> NostosUnavailableError:
        reason = exc.reason
        if isinstance(reason, (TimeoutError, socket.timeout)):
            detail = "request timed out"
        else:
            detail = f"connection failed: {reason!r}"
        return NostosUnavailableError(self._msg(detail))

    def _msg(self, detail: str) -> str:
        return f"Nostos client error at {self._origin}: {detail}"

    @property
    def _origin(self) -> str:
        """Scheme/host/port only — never userinfo, path, query, or body."""
        parts = urllib.parse.urlsplit(self._base_url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        return f"{parts.scheme}://{parts.hostname}:{port}"
