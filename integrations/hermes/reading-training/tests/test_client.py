"""Tests for the stateless Nostos gateway client (real local HTTP transport)."""

from __future__ import annotations

import json
import socket

import pytest

from nostos_reading_connector.client import (
    DEFAULT_BASE_URL,
    DISPATCH_PATH,
    INBOX_PATH,
    NOTIFICATIONS_LEASE_PATH,
    NostosClient,
    NostosProtocolError,
    NostosUnavailableError,
)

from conftest import _GatewayHandler


def client(base_url, timeout=2.0) -> NostosClient:
    return NostosClient(base_url, timeout=timeout)


def envelope(reply, data=None, state_version="0", duplicate=False) -> str:
    return json.dumps(
        {"reply": reply, "data": data, "stateVersion": state_version, "duplicate": duplicate}
    )


# --------------------------------------------------------------------------
# Dispatch: exact path, method, JSON body, string preservation
# --------------------------------------------------------------------------


class TestDispatchWire:
    def test_exact_path_method_and_json(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        c = client(gateway_server)
        c.dispatch("nostos-telegram", "nostos-reading:987654321:1001", "pause")
        (method, path, body), = recorded_requests
        assert method == "POST"
        assert path == DISPATCH_PATH
        assert body == (
            b'{"clientId":"nostos-telegram",'
            b'"idempotencyKey":"nostos-reading:987654321:1001",'
            b'"text":"pause"}'
        )

    def test_unicode_and_whitespace_preserved_byte_exact(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        c = client(gateway_server)
        text = "  Добрый день 👋\n\tline two  "
        c.dispatch("c", "k", text)
        (_, _, body), = recorded_requests
        assert body == json.dumps(
            {"clientId": "c", "idempotencyKey": "k", "text": text},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        assert json.loads(body.decode("utf-8"))["text"] == text  # exact round-trip

    def test_special_characters_escaped_properly(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        c = client(gateway_server)
        text = 'say "hi" \\ backslash \u00e9\u4e2d\u6587'
        c.dispatch("c", "k", text)
        (_, _, body), = recorded_requests
        assert json.loads(body.decode("utf-8"))["text"] == text

    def test_no_stripping(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        c = client(gateway_server)
        c.dispatch("c", "k", "   pause   ")
        (_, _, body), = recorded_requests
        assert b'"text":"   pause   "' in body

    def test_headers(self, gateway_server):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        _GatewayHandler.response_queue.append((200, envelope("ok", data=[]), "application/json"))
        c = client(gateway_server)
        c.dispatch("c", "k", "pause")
        (headers,) = _GatewayHandler.request_headers
        assert headers.get("Content-Type") == "application/json; charset=utf-8"
        assert headers.get("Accept") == "application/json"
        c.get_inbox()
        (get_headers,) = _GatewayHandler.request_headers[-1:]
        assert "Content-Type" not in get_headers  # GET carries no body/content-type


# --------------------------------------------------------------------------
# Dispatch: envelope parsing (success, duplicate, domain errors)
# --------------------------------------------------------------------------


class TestDispatchParsing:
    def test_success(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (200, envelope("Started. Keep reading.", state_version="7"), "application/json")
        )
        result = client(gateway_server).dispatch("c", "k", "start")
        assert result.reply == "Started. Keep reading."
        assert result.state_version == "7"
        assert result.duplicate is False
        assert result.http_status == 200
        assert result.error_code is None
        assert not result.is_error

    def test_duplicate_flag(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (200, envelope("Started. Keep reading.", state_version="7", duplicate=True), "application/json")
        )
        result = client(gateway_server).dispatch("c", "k", "start")
        assert result.duplicate is True
        assert result.error_code is None

    @pytest.mark.parametrize(
        "status,code,reply",
        [
            (422, "gateway_ignored", "Not a reading-gateway command."),
            (409, "not_initialized", "Reading training is not initialized."),
            (409, "already_active", "A reading session is already active."),
            (400, "invalid_ratings", "Ratings must be whole numbers from 1 to 10."),
            (404, "no_active_session", "No active reading session."),
        ],
    )
    def test_domain_errors_returned_not_raised(self, gateway_server, status, code, reply):
        _GatewayHandler.response_queue.append(
            (status, envelope(reply, data={"code": code}, state_version="0"), "application/json")
        )
        result = client(gateway_server).dispatch("c", "k", "whatever")
        assert result.http_status == status
        assert result.error_code == code
        assert result.reply == reply
        assert result.is_error

    def test_error_data_non_string_code_treated_as_success(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (200, envelope("ok", data={"code": 5}), "application/json")
        )
        result = client(gateway_server).dispatch("c", "k", "x")
        assert result.error_code is None
        assert result.data == {"code": 5}


# --------------------------------------------------------------------------
# Dispatch: malformed responses raise typed protocol errors
# --------------------------------------------------------------------------


class TestMalformedResponses:
    @pytest.mark.parametrize(
        "status,body,content_type",
        [
            (200, "not json at all", "text/plain"),
            (200, "<html>oops</html>", "text/html"),
            (500, "<html>internal error</html>", "text/html"),
            (200, '{"reply": 5, "stateVersion": "0"}', "application/json"),
            (200, '{"stateVersion": "0"}', "application/json"),
            (200, '{"reply": "ok"}', "application/json"),
            (200, '{"reply": "ok", "stateVersion": "0", "duplicate": "yes"}', "application/json"),
            (200, "[1, 2, 3]", "application/json"),
            (200, "null", "application/json"),
            (200, "", "application/json"),
        ],
    )
    def test_protocol_error(self, gateway_server, status, body, content_type):
        _GatewayHandler.response_queue.append((status, body, content_type))
        with pytest.raises(NostosProtocolError):
            client(gateway_server).dispatch("c", "k", "x")

    def test_protocol_error_message_leaks_no_body(self, gateway_server):
        secret_body = "SENSITIVE-SERVER-BODY-MARKER"
        _GatewayHandler.response_queue.append((500, secret_body, "text/html"))
        with pytest.raises(NostosProtocolError) as excinfo:
            client(gateway_server).dispatch("c", "k", "x")
        message = str(excinfo.value)
        assert secret_body not in message  # response bodies never enter errors
        assert "dispatch" not in message  # request path/query never enters errors

    def test_no_retry_on_protocol_error(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((500, "not an envelope", "text/html"))
        with pytest.raises(NostosProtocolError):
            client(gateway_server).dispatch("c", "k", "x")
        assert len(recorded_requests) == 1

    def test_no_retry_on_domain_error(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((422, envelope("ignored", {"code": "gateway_ignored"}), "application/json"))
        result = client(gateway_server).dispatch("c", "k", "x")
        assert result.error_code == "gateway_ignored"
        assert len(recorded_requests) == 1


# --------------------------------------------------------------------------
# Transport availability errors
# --------------------------------------------------------------------------


def _closed_port() -> int:
    """Bind and release a socket so the port is deterministically closed."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class TestAvailability:
    def test_connection_refused(self):
        with pytest.raises(NostosUnavailableError):
            client(f"http://127.0.0.1:{_closed_port()}", timeout=1.0).dispatch("c", "k", "x")

    def test_timeout(self, gateway_server):
        _GatewayHandler.sleep = 1.0
        with pytest.raises(NostosUnavailableError):
            client(gateway_server, timeout=0.2).dispatch("c", "k", "x")

    def test_unavailable_error_leaks_no_credentials_or_body(self):
        port = _closed_port()
        with pytest.raises(NostosUnavailableError) as excinfo:
            client(f"http://user:sekrit-token@{'127.0.0.1'}:{port}", timeout=1.0).dispatch(
                "c", "k", "top-secret-body"
            )
        message = str(excinfo.value)
        assert "sekrit-token" not in message
        assert "user:" not in message
        assert "top-secret-body" not in message
        assert f"127.0.0.1:{port}" in message

    def test_client_is_stateless_after_failure(self, gateway_server):
        # One failed call must not poison the client for the next call.
        with pytest.raises(NostosUnavailableError):
            client(f"http://127.0.0.1:{_closed_port()}", timeout=1.0).dispatch("c", "k", "x")
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        result = client(gateway_server).dispatch("c", "k", "x")
        assert result.reply == "ok"


# --------------------------------------------------------------------------
# Client construction guards
# --------------------------------------------------------------------------


class TestConstruction:
    @pytest.mark.parametrize(
        "base_url",
        [
            "",
            "not-a-url",
            "ftp://127.0.0.1:5214",
            "http://127.0.0.1:5214/some/path",
            "http://127.0.0.1:5214?x=1",
            "http://127.0.0.1:5214#frag",
        ],
    )
    def test_invalid_base_url(self, base_url):
        with pytest.raises(ValueError):
            NostosClient(base_url)

    @pytest.mark.parametrize("timeout", [0, -1, float("inf"), float("nan"), True, "5"])
    def test_invalid_timeout(self, timeout):
        with pytest.raises(ValueError):
            NostosClient(DEFAULT_BASE_URL, timeout=timeout)

    def test_defaults(self):
        c = NostosClient()
        assert c._base_url == DEFAULT_BASE_URL
        assert c._timeout == 5.0

    def test_empty_identity_fields_rejected(self, gateway_server):
        c = client(gateway_server)
        with pytest.raises(ValueError):
            c.dispatch("", "k", "x")
        with pytest.raises(ValueError):
            c.dispatch("c", "", "x")
        with pytest.raises(TypeError):
            c.dispatch("c", "k", 42)  # type: ignore[arg-type]
        assert len(_GatewayHandler.requests) == 0  # nothing was sent


# --------------------------------------------------------------------------
# Inbox parsing
# --------------------------------------------------------------------------


class TestInbox:
    def test_parses_captures(self, gateway_server):
        payload = [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "text": "  keep me  ",
                "type": 1,
                "bookId": "22222222-2222-2222-2222-222222222222",
                "sessionId": "33333333-3333-3333-3333-333333333333",
                "externalId": "gateway:telegram:987654321:1001",
                "resolved": False,
                "promotedNoteId": None,
                "createdAt": "2026-08-09T12:00:00Z",
            },
            {
                "id": "44444444-4444-4444-4444-444444444444",
                "text": "bookmark",
                "type": 2,
                "bookId": "22222222-2222-2222-2222-222222222222",
                "sessionId": None,
                "externalId": None,
                "resolved": True,
                "promotedNoteId": "55555555-5555-5555-5555-555555555555",
                "createdAt": "2026-08-09T13:00:00Z",
            },
        ]
        _GatewayHandler.response_queue.append(
            (200, envelope("2 items", data=payload, state_version="9"), "application/json")
        )
        result = client(gateway_server).get_inbox()
        assert not result.is_error
        assert result.reply == "2 items"
        assert result.state_version == "9"
        assert len(result.captures) == 2
        first, second = result.captures
        assert first.id == payload[0]["id"]
        assert first.text == "  keep me  "
        assert first.type == 1
        assert first.book_id == payload[0]["bookId"]
        assert first.session_id == payload[0]["sessionId"]
        assert first.external_id == payload[0]["externalId"]
        assert first.resolved is False
        assert first.promoted_note_id is None
        assert first.created_at == payload[0]["createdAt"]
        assert second.type == 2
        assert second.resolved is True
        assert second.promoted_note_id == payload[1]["promotedNoteId"]

    def test_null_data_is_empty_inbox(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (200, envelope("ok", data=None, state_version="0"), "application/json")
        )
        result = client(gateway_server).get_inbox()
        assert result.captures == ()

    def test_missing_optionals_default(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (
                200,
                envelope(
                    "ok",
                    data=[
                        {
                            "id": "1",
                            "text": "t",
                            "type": 0,
                            "bookId": "b",
                            "createdAt": "2026-08-09T12:00:00Z",
                        }
                    ],
                ),
                "application/json",
            )
        )
        result = client(gateway_server).get_inbox()
        (capture,) = result.captures
        assert capture.session_id is None
        assert capture.external_id is None
        assert capture.resolved is False
        assert capture.promoted_note_id is None

    def test_domain_error_envelope(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (409, envelope("Reading training is not initialized.", {"code": "not_initialized"}), "application/json")
        )
        result = client(gateway_server).get_inbox()
        assert result.is_error
        assert result.error_code == "not_initialized"
        assert result.captures == ()
        assert result.http_status == 409

    @pytest.mark.parametrize(
        "data",
        [
            {"not": "a list"},
            [{"id": "1", "text": "t", "type": "wrong", "bookId": "b", "createdAt": "c"}],
            [{"text": "t", "type": 0, "bookId": "b", "createdAt": "c"}],  # missing id
            [{"id": "1", "text": "t", "type": 0, "bookId": "b"}],  # missing createdAt
            ["not-an-object"],
            [{"id": "1", "text": "t", "type": True, "bookId": "b", "createdAt": "c"}],
            [{"id": "1", "text": "t", "type": 0, "bookId": "b", "createdAt": "c", "resolved": "yes"}],
        ],
    )
    def test_malformed_inbox_raises_protocol_error(self, gateway_server, data):
        _GatewayHandler.response_queue.append(
            (200, envelope("ok", data=data), "application/json")
        )
        with pytest.raises(NostosProtocolError):
            client(gateway_server).get_inbox()

    def test_inbox_exact_path(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok", data=[]), "application/json"))
        client(gateway_server).get_inbox()
        (method, path, body), = recorded_requests
        assert method == "GET"
        assert path == INBOX_PATH
        assert body == b""


# --------------------------------------------------------------------------
# Optional lease/ack wrappers (bounded; no sending)
# --------------------------------------------------------------------------


class TestNotifications:
    def test_lease_exact_path_and_query(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append(
            (
                200,
                json.dumps(
                    [
                        {
                            "notificationId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                            "payload": {"kind": "target-reached", "mode": 1},
                            "leaseUntil": "2026-08-09T12:01:00Z",
                        }
                    ]
                ),
                "application/json",
            )
        )
        claimed = client(gateway_server).lease_notifications(max_count=5, lease_seconds=30)
        (method, path, body), = recorded_requests
        assert method == "GET"
        assert path == f"{NOTIFICATIONS_LEASE_PATH}?maxCount=5&leaseSeconds=30"
        assert body == b""
        (item,) = claimed
        assert item.notification_id == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        assert item.payload == {"kind": "target-reached", "mode": 1}
        assert item.lease_until == "2026-08-09T12:01:00Z"

    def test_lease_defaults(self, gateway_server, recorded_requests):
        _GatewayHandler.response_queue.append((200, "[]", "application/json"))
        client(gateway_server).lease_notifications()
        (_, path, _), = recorded_requests
        assert path == f"{NOTIFICATIONS_LEASE_PATH}?maxCount=10&leaseSeconds=60"

    @pytest.mark.parametrize(
        "max_count,lease_seconds",
        [(0, 60), (101, 60), (10, 0), (10, 3601), (True, 60), (10, "60")],
    )
    def test_lease_invalid_bounds(self, gateway_server, max_count, lease_seconds):
        with pytest.raises(ValueError):
            client(gateway_server).lease_notifications(max_count, lease_seconds)

    def test_lease_non2xx_raises(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (400, '{"type":"problem","status":400}', "application/problem+json")
        )
        with pytest.raises(NostosProtocolError):
            client(gateway_server).lease_notifications()

    def test_ack_exact_path_and_no_body(self, gateway_server, recorded_requests):
        notification_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        _GatewayHandler.response_queue.append(
            (200, json.dumps({"notificationId": notification_id, "acknowledged": True}), "application/json")
        )
        result = client(gateway_server).ack_notification(notification_id)
        (method, path, body), = recorded_requests
        assert method == "POST"
        assert path == f"/api/reading-training/notifications/{notification_id}/ack"
        assert body == b""
        assert result.notification_id == notification_id
        assert result.acknowledged is True

    def test_ack_unknown_id_raises_typed_error(self, gateway_server):
        _GatewayHandler.response_queue.append(
            (404, '{"type":"problem","title":"Notification not found.","status":404}', "application/problem+json")
        )
        with pytest.raises(NostosProtocolError) as excinfo:
            client(gateway_server).ack_notification("unknown")
        assert "404" in str(excinfo.value)

    def test_ack_validation(self, gateway_server):
        with pytest.raises(ValueError):
            client(gateway_server).ack_notification("")
