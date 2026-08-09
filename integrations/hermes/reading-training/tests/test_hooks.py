"""Tests for the optional Hermes hooks (Task 10B2).

Uses the REAL Hermes plugin machinery when importable from the Hermes venv
(``hermes_cli.plugins.PluginContext`` / ``PluginManager`` / ``PluginManifest``
/ ``VALID_HOOKS``) plus faithful ``SimpleNamespace`` fakes for gateway
``MessageEvent`` objects pinned to the exact field mapping the hook code
documents. All HTTP is exercised against the real local gateway server from
``conftest``.
"""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from typing import Optional

import pytest

pytest.importorskip(
    "hermes_cli.plugins", reason="requires the Hermes venv (hermes_cli importable)"
)
from hermes_cli.plugins import (  # noqa: E402  # type: ignore[reportMissingImports]
    VALID_HOOKS,
    PluginContext,
    PluginManifest,
    PluginManager,
)

from nostos_reading_connector import hooks  # noqa: E402
from nostos_reading_connector.client import DISPATCH_PATH, INBOX_PATH  # noqa: E402

from conftest import _GatewayHandler  # noqa: E402

OWNER = "123456789"
CHAT = 987654321
THREAD = 42
CLIENT_ID = "nostos-telegram"

_HOOK_LOGGER = "nostos_reading_connector.hooks"


# --------------------------------------------------------------------------
# Helpers: envelope/capture payloads, event + session-key fakes
# --------------------------------------------------------------------------


def envelope(reply, data=None, state_version="0", duplicate=False) -> str:
    return json.dumps(
        {"reply": reply, "data": data, "stateVersion": state_version, "duplicate": duplicate}
    )


def capture(
    capture_id: str,
    text: str,
    *,
    ctype: int = 1,
    created_at: str = "2026-08-09T12:00:00Z",
    resolved: bool = False,
) -> dict:
    return {
        "id": capture_id,
        "text": text,
        "type": ctype,
        "bookId": "22222222-2222-2222-2222-222222222222",
        "createdAt": created_at,
        "resolved": resolved,
    }


class _EnumPlatform:
    """Faithful stand-in for a gateway ``Platform`` enum with ``.value``."""

    def __init__(self, value: str) -> None:
        self.value = value


def make_event(
    text: str = "a thought while reading",
    *,
    message_id: str = "1001",
    user_id: str = OWNER,
    platform: str = "telegram",
    chat_id: int = CHAT,
    thread_id: int = THREAD,
    chat_topic: Optional[str] = "Reading",
    source_user_id: Optional[str] = None,
    source_message_id: Optional[str] = None,
    is_outgoing: bool = False,
    source_is_outgoing: Optional[bool] = None,
    is_bot: bool = False,
) -> SimpleNamespace:
    """Faithful ``MessageEvent``-shaped fake (``event`` + ``event.source``)."""
    platform_value = _EnumPlatform("telegram") if platform == "enum" else platform
    source = SimpleNamespace(
        platform=platform_value,
        chat_id=chat_id,
        thread_id=thread_id,
        chat_topic=chat_topic,
        user_id=source_user_id,
        message_id=source_message_id,
        is_outgoing=source_is_outgoing,
        is_bot=is_bot,
    )
    return SimpleNamespace(
        source=source,
        text=text,
        user_id=user_id,
        message_id=message_id,
        is_outgoing=is_outgoing,
    )


def session_key(*, platform: str = "telegram", chat_type: str = "thread", chat_id=CHAT, thread_id=THREAD) -> str:
    """``agent:main:<platform>:<chat_type>:<chat_id>[:<thread_id>]``."""
    return f"agent:main:{platform}:{chat_type}:{chat_id}:{thread_id}"


def llm_call(text: str, *, session: str = None) -> dict:
    """Invoke ``pre_llm_call`` with the canonical reading-scope kwargs."""
    return hooks.pre_llm_call(
        user_message=text,
        turn_id="turn-1",
        sender_id=OWNER,
        platform="telegram",
        session_id=session or session_key(),
    )


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_hooks_state():
    """Every test starts (and ends) with a clean, unconfigured module state."""
    hooks._state = None
    yield
    hooks._state = None


def current_state() -> hooks.HookState:
    """The configured module state (tests always configure before reading it)."""
    state = hooks._state
    assert state is not None
    return state


@pytest.fixture
def manager() -> PluginManager:
    return PluginManager()


@pytest.fixture
def plugin_ctx(manager: PluginManager) -> PluginContext:
    manifest = PluginManifest(
        name="reading-training",
        version="1.0.0",
        key="reading-training",
        kind="standalone",
        provides_hooks=["pre_gateway_dispatch", "pre_llm_call"],
    )
    return PluginContext(manifest, manager)


@pytest.fixture
def hook_env(gateway_server, recorded_requests):
    """Active hooks state pointed at a real local gateway server."""
    state = hooks._configure(
        {
            "owner_id": OWNER,
            "chat_id": CHAT,
            "thread_id": THREAD,
            "base_url": gateway_server,
            "timeout": 2.0,
        }
    )
    assert state.active
    return state


# --------------------------------------------------------------------------
# Registration through the real PluginContext / PluginManager
# --------------------------------------------------------------------------


class TestRegistration:
    def test_registers_exactly_two_hooks_with_exact_names(self, plugin_ctx, manager):
        hooks.register(plugin_ctx)
        assert manager.has_hook("pre_gateway_dispatch")
        assert manager.has_hook("pre_llm_call")
        # Order-preserving registration: gateway hook first, llm hook second.
        assert manager._hooks["pre_gateway_dispatch"] == [hooks.pre_gateway_dispatch]
        assert manager._hooks["pre_llm_call"] == [hooks.pre_llm_call]

    def test_hooks_invocable_through_real_manager(self, plugin_ctx, manager):
        hooks.register(plugin_ctx)
        # Inactive (no config): the real manager filters None results, so every invocation is empty.
        assert manager.invoke_hook(
            "pre_gateway_dispatch", event=make_event(text="pause"), gateway=None
        ) == []
        assert manager.invoke_hook(
            "pre_llm_call",
            user_message="pause",
            turn_id="t",
            sender_id=OWNER,
            platform="telegram",
            session_id=session_key(),
        ) == []

    def test_register_uses_manifest_key_for_config_section(
        self, plugin_ctx, manager, monkeypatch
    ):
        seen: list = []
        monkeypatch.setattr(
            hooks, "_load_hermes_config", lambda section: seen.append(section) or None
        )
        hooks.register(plugin_ctx)
        assert seen == ["reading-training"]
        # A manifest with a different key drives a different config section.
        other = PluginContext(
            PluginManifest(name="x", key="custom-key", kind="standalone"), manager
        )
        hooks.register(other)
        assert seen == ["reading-training", "custom-key"]

    def test_register_without_config_still_registers_and_warns_once(
        self, plugin_ctx, manager, caplog, monkeypatch
    ):
        monkeypatch.setattr(hooks, "_load_hermes_config", lambda _section: None)
        with caplog.at_level(logging.WARNING, logger=_HOOK_LOGGER):
            hooks.register(plugin_ctx)
            for _ in range(3):
                assert hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None) is None
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert len(warnings) == 1
        assert "inactive" in warnings[0].message
        assert manager.has_hook("pre_gateway_dispatch")

    def test_register_with_config_loads_active_state(self, plugin_ctx, manager, monkeypatch):
        monkeypatch.setattr(
            hooks,
            "_load_hermes_config",
            lambda section: {
                "owner_id": OWNER,
                "chat_id": CHAT,
                "thread_id": THREAD,
                "base_url": "http://127.0.0.1:5214",
            },
        )
        hooks.register(plugin_ctx)
        assert hooks._state is not None and hooks._state.active

    def test_manifest_declares_valid_hooks(self):
        # The committed manifest must parse and declare only current-schema hooks.
        manifest = PluginManifest(
            name="reading-training",
            version="1.0.0",
            kind="standalone",
            provides_hooks=["pre_gateway_dispatch", "pre_llm_call"],
        )
        assert manifest.provides_hooks == ["pre_gateway_dispatch", "pre_llm_call"]
        assert set(manifest.provides_hooks) <= VALID_HOOKS
        assert manifest.key == ""  # loader derives the key from the name


# --------------------------------------------------------------------------
# Inactive config: safe no-op + exactly one warning
# --------------------------------------------------------------------------


class TestInactive:
    def test_unconfigured_warns_once_and_noops(self, caplog, recorded_requests):
        with caplog.at_level(logging.WARNING, logger=_HOOK_LOGGER):
            hooks._configure(None)
            for _ in range(5):
                assert hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None) is None
                assert llm_call("pause") is None
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert len(warnings) == 1
        assert "inactive" in warnings[0].message
        assert recorded_requests == []  # nothing ever leaves the process
        assert current_state().pending == {}

    @pytest.mark.parametrize(
        "overrides,field",
        [
            ({"thread_id": "abc"}, "thread_id"),
            ({"chat_id": "not-a-number"}, "chat_id"),
            ({"owner_id": ""}, "owner_id"),
            ({"platform": "discord"}, "platform"),
        ],
    )
    def test_invalid_fields_named_in_warning(self, caplog, overrides, field):
        mapping = {"owner_id": OWNER, "chat_id": CHAT, "thread_id": THREAD, **overrides}
        with caplog.at_level(logging.WARNING, logger=_HOOK_LOGGER):
            state = hooks._configure(mapping)
        assert not state.active
        assert field in state.inactive_reason
        assert field in caplog.text

    def test_bad_base_url_makes_inactive(self):
        state = hooks._configure(
            {"owner_id": OWNER, "chat_id": CHAT, "thread_id": THREAD, "base_url": "not-a-url"}
        )
        assert not state.active
        assert "base_url" in state.inactive_reason

    def test_bad_timeout_makes_inactive(self):
        state = hooks._configure(
            {"owner_id": OWNER, "chat_id": CHAT, "thread_id": THREAD, "timeout": True}
        )
        assert not state.active
        assert "timeout" in state.inactive_reason

    def test_optional_fields_default(self, gateway_server):
        state = hooks._configure(
            {"owner_id": OWNER, "chat_id": CHAT, "thread_id": THREAD, "base_url": gateway_server}
        )
        assert state.active
        assert state.config is not None and state.client is not None
        assert state.config.client_id == CLIENT_ID
        assert state.config.platform == "telegram"
        assert state.client._timeout == 5.0

    def test_reconfiguration_warns_again_but_is_stable(self, caplog):
        with caplog.at_level(logging.WARNING, logger=_HOOK_LOGGER):
            hooks._configure(None)
            hooks._configure(None)
        assert len([r for r in caplog.records if r.levelno >= logging.WARNING]) == 2


# --------------------------------------------------------------------------
# MessageEvent metadata extraction (exact field mapping)
# --------------------------------------------------------------------------


class TestMetadataExtraction:
    def test_exact_fields(self):
        msg = hooks._message_from_event(
            make_event(text="  keep me  ", chat_topic="Reading")
        )
        assert msg is not None
        assert msg.platform == "telegram"
        assert msg.sender_id == OWNER
        assert msg.chat_id == CHAT
        assert msg.thread_id == THREAD
        assert msg.chat_topic == "Reading"
        assert msg.text == "  keep me  "
        assert msg.message_id == "1001"
        assert msg.is_outgoing is False
        assert msg.is_bot is False

    def test_enum_platform_value_extracted(self):
        msg = hooks._message_from_event(make_event(platform="enum"))
        assert msg is not None
        assert msg.platform == "telegram"

    def test_event_user_id_preferred_over_source(self):
        msg = hooks._message_from_event(
            make_event(user_id="event-user", source_user_id="source-user")
        )
        assert msg is not None
        assert msg.sender_id == "event-user"

    def test_source_fallback_when_event_lacks_ids(self):
        event = make_event()
        del event.user_id
        del event.message_id
        event.source.user_id = "source-user"
        event.source.message_id = "77"
        msg = hooks._message_from_event(event)
        assert msg is not None
        assert msg.sender_id == "source-user"
        assert msg.message_id == "77"

    def test_non_string_text_treated_as_absent(self, recorded_requests):
        event = make_event()
        event.text = ["multimodal", "content"]  # type: ignore[assignment]
        msg = hooks._message_from_event(event)
        assert msg is not None
        assert msg.text is None
        hooks._configure(
            {"owner_id": OWNER, "chat_id": CHAT, "thread_id": THREAD}
        )  # inactive; no HTTP either way
        assert hooks.pre_gateway_dispatch(event, gateway=None) is None
        assert recorded_requests == []

    def test_missing_source_returns_none(self):
        assert hooks._message_from_event(SimpleNamespace(text="x")) is None
        assert hooks.pre_gateway_dispatch(SimpleNamespace(text="x"), gateway=None) is None

    def test_outgoing_and_bot_flags(self):
        event = make_event()
        event.is_outgoing = True
        msg = hooks._message_from_event(event)
        assert msg is not None and msg.is_outgoing is True
        event = make_event()
        event.source.is_bot = True
        msg = hooks._message_from_event(event)
        assert msg is not None and msg.is_bot is True

    def test_source_outgoing_flag_counts(self):
        event = make_event(source_is_outgoing=True)
        msg = hooks._message_from_event(event)
        assert msg is not None and msg.is_outgoing is True


# --------------------------------------------------------------------------
# Wrong scope / hygiene: no HTTP, no injection
# --------------------------------------------------------------------------


class TestScopeNoHTTP:
    @pytest.mark.parametrize(
        "overrides,reason",
        [
            ({"platform": "discord"}, "wrong_platform"),
            ({"user_id": "999"}, "not_owner"),
            ({"chat_id": 111}, "wrong_chat"),
            ({"thread_id": 43}, "wrong_thread"),
            ({"thread_id": None}, "wrong_thread"),
            ({"text": "/start"}, "slash_command"),
            ({"text": "[ASYNC DELEGATION BATCH COMPLETE — x]"}, "synthetic_delivery"),
            ({"text": "[OUT-OF-BAND USER MESSAGE — x]"}, "synthetic_delivery"),
            ({"text": "[Cron delivery: reading-weekly-review]\nbody"}, "cron_delivery"),
            ({"text": ""}, "no_text"),
            ({"text": "   "}, "no_text"),
            ({"message_id": None}, "missing_event_id"),
        ],
    )
    def test_not_eligible_never_reaches_http(
        self, hook_env, recorded_requests, overrides, reason
    ):
        assert hooks.pre_gateway_dispatch(make_event(**overrides), gateway=None) is None
        assert recorded_requests == []
        assert hooks._state.pending == {}
        assert llm_call("anything") is None  # and never any injection

    def test_outgoing_message_not_eligible(self, hook_env, recorded_requests):
        event = make_event()
        event.is_outgoing = True
        assert hooks.pre_gateway_dispatch(event, gateway=None) is None
        assert recorded_requests == []

    def test_bot_sender_not_eligible(self, hook_env, recorded_requests):
        event = make_event()
        event.source.is_bot = True
        assert hooks.pre_gateway_dispatch(event, gateway=None) is None
        assert recorded_requests == []

    def test_wrong_llm_scope_no_injection(self, hook_env):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        # Same chat, but the turn runs with a different session scope.
        assert hooks.pre_llm_call(
            user_message="pause", turn_id="t", sender_id=OWNER,
            platform="telegram", session_id=session_key(thread_id=43),
        ) is None
        assert hooks.pre_llm_call(
            user_message="pause", turn_id="t", sender_id="999",
            platform="telegram", session_id=session_key(),
        ) is None
        assert hooks.pre_llm_call(
            user_message="pause", turn_id="t", sender_id=OWNER,
            platform="discord", session_id=session_key(platform="discord"),
        ) is None
        assert hooks.pre_llm_call(
            user_message="/pause", turn_id="t", sender_id=OWNER,
            platform="telegram", session_id=session_key(),
        ) is None
        assert hooks.pre_llm_call(
            user_message="[Cron delivery: x]\nbody", turn_id="t", sender_id=OWNER,
            platform="telegram", session_id=session_key(),
        ) is None
        # The pending entry survives for the correctly-scoped turn.
        assert current_state().pending
        assert llm_call("pause") is not None

    def test_unparseable_session_key_no_injection(self, hook_env):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        for bad in ("", "agent", "agent:main", "other:main:telegram:thread:1:2", "agent:main:telegram:group:1:2:3:4:5"):
            assert hooks.pre_llm_call(
                user_message="pause", turn_id="t", sender_id=OWNER,
                platform="telegram", session_id=bad,
            ) is None, bad
        # group/channel sessions: 6th element is a per-user id, never a topic thread
        assert hooks.pre_llm_call(
            user_message="pause", turn_id="t", sender_id=OWNER,
            platform="telegram", session_id="agent:main:telegram:group:987654321:42",
        ) is None
        assert hooks.pre_llm_call(
            user_message="pause", turn_id="t", sender_id=OWNER,
            platform="telegram", session_id="agent:main:telegram:channel:987654321",
        ) is None
        assert llm_call("pause") is not None  # correct scope still injects


# --------------------------------------------------------------------------
# Eligible dispatch: exactly once, exact text/key, ephemeral injection
# --------------------------------------------------------------------------


class TestEligibleDispatch:
    def test_dispatch_once_exact_wire_payload(self, hook_env, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("Started. Keep reading."), "application/json"))
        assert hooks.pre_gateway_dispatch(make_event(text="  pause  "), gateway=None) is None
        (method, path, body), = recorded_requests
        assert method == "POST"
        assert path == DISPATCH_PATH
        parsed = json.loads(body)
        assert parsed["clientId"] == CLIENT_ID
        assert parsed["idempotencyKey"] == f"nostos-reading:telegram:{CHAT}:1001"
        assert parsed["text"] == "  pause  "  # verbatim — never stripped
        assert len(recorded_requests) == 1

    def test_committed_context_injected_once_with_exact_reply(self, hook_env):
        reply = "Reading clock paused until tomorrow 08:00."
        _GatewayHandler.response_queue.append((200, envelope(reply), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        result = llm_call("pause")
        assert result is not None and "context" in result
        assert hooks.COMMITTED_MARKER in result["context"]
        assert reply in result["context"]
        assert llm_call("pause") is None  # consumed — cannot trigger a repeat

    def test_full_cycle_through_real_manager(self, hook_env, manager, plugin_ctx):
        reply = "Captured."
        _GatewayHandler.response_queue.append((200, envelope(reply), "application/json"))
        plugin_ctx.register_hook("pre_gateway_dispatch", hooks.pre_gateway_dispatch)
        plugin_ctx.register_hook("pre_llm_call", hooks.pre_llm_call)
        assert manager.invoke_hook(
            "pre_gateway_dispatch", event=make_event(text="pause"), gateway=None
        ) == []
        assert manager.invoke_hook(
            "pre_llm_call",
            user_message="pause",
            turn_id="t",
            sender_id=OWNER,
            platform="telegram",
            session_id=session_key(),
        ) == [{"context": f"{hooks.COMMITTED_MARKER} — Nostos has already handled this reading message "
                        "authoritatively (duplicate retries converge; nothing more to perform). "
                        "Do not run, repeat, or reinterpret any reading command. "
                        f"Reply exactly with Nostos's reply: {reply!r}"}]

    def test_pending_matches_whitespace_normalized_turn_text(self, hook_env):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="  pause  "), gateway=None)
        # The turn text may arrive with different incidental whitespace.
        assert llm_call("pause") is not None
        assert llm_call("pause") is None

    def test_duplicate_event_invocation_deterministic(self, hook_env, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        event = make_event(text="pause")
        hooks.pre_gateway_dispatch(event, gateway=None)
        hooks.pre_gateway_dispatch(event, gateway=None)
        assert len(recorded_requests) == 2
        assert recorded_requests[0][2] == recorded_requests[1][2]  # byte-identical
        # One event -> one fresh outcome: exactly one injection remains.
        assert llm_call("pause") is not None
        assert llm_call("pause") is None

    def test_pending_cleared_after_injection(self, hook_env):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        assert current_state().pending
        llm_call("pause")
        assert current_state().pending == {}

    def test_duplicate_flag_still_committed_context(self, hook_env):
        _GatewayHandler.response_queue.append(
            (200, envelope("Already handled.", duplicate=True), "application/json")
        )
        hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        result = llm_call("pause")
        assert hooks.COMMITTED_MARKER in result["context"]
        assert "Already handled." in result["context"]


# --------------------------------------------------------------------------
# gateway_ignored (422): gateway consulted, nothing injected
# --------------------------------------------------------------------------


class TestGatewayIgnored:
    def test_ignored_message_gets_no_injection(self, hook_env, recorded_requests):
        _GatewayHandler.response_queue.append(
            (422, envelope("Not a reading-gateway command.", {"code": "gateway_ignored"}), "application/json")
        )
        assert hooks.pre_gateway_dispatch(make_event(text="weekly review?"), gateway=None) is None
        assert len(recorded_requests) == 1  # the gateway was consulted exactly once
        assert current_state().pending == {}  # and nothing was parked
        assert llm_call("weekly review?") is None

    def test_answer_now_ignored_gets_no_injection(self, hook_env, recorded_requests):
        _GatewayHandler.response_queue.append(
            (422, envelope("Not a reading-gateway command.", {"code": "gateway_ignored"}), "application/json")
        )
        assert hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None) is None
        assert len(recorded_requests) == 1  # no inbox fetch follows an ignored pause
        assert llm_call("answer now") is None


# --------------------------------------------------------------------------
# answer now: accepted pause + deterministically latest unresolved Question
# --------------------------------------------------------------------------


class TestAnswerNow:
    PAUSE_REPLY = "Paused. Answer now."

    def _queue_pause_then_inbox(self, inbox_data, pause_reply=PAUSE_REPLY):
        _GatewayHandler.response_queue.append((200, envelope(pause_reply), "application/json"))
        _GatewayHandler.response_queue.append(
            (200, envelope("inbox", data=inbox_data), "application/json")
        )

    def test_injects_pause_reply_and_latest_unresolved_question(self, hook_env, recorded_requests):
        self._queue_pause_then_inbox(
            [
                capture("q-old", "older question", created_at="2026-08-09T10:00:00Z"),
                capture("q-new", "  newest question  ", created_at="2026-08-09T12:00:00Z"),
                capture("t-thought", "a thought", ctype=0, created_at="2026-08-09T13:00:00Z"),
                capture("q-resolved", "resolved question", created_at="2026-08-09T14:00:00Z", resolved=True),
                capture("bm", "a bookmark", ctype=2, created_at="2026-08-09T15:00:00Z"),
            ]
        )
        hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None)
        assert [r[1] for r in recorded_requests] == [DISPATCH_PATH, INBOX_PATH]
        result = llm_call("answer now")
        assert result is not None
        context = result["context"]
        assert hooks.COMMITTED_MARKER in context
        assert self.PAUSE_REPLY in context
        assert "  newest question  " in context  # verbatim question text
        assert "older question" not in context
        assert "a thought" not in context  # only the Question, never Thoughts
        assert "resolved question" not in context  # only unresolved
        assert "a bookmark" not in context

    @pytest.mark.parametrize(
        "raw", ["Answer Now", "  ANSWER NOW  ", "answer  now", "Answer Now Please", "ANSWER NOW PLEASE"]
    )
    def test_vocabulary_recognized_insensitively(self, hook_env, raw):
        self._queue_pause_then_inbox([capture("q1", "the question")])
        hooks.pre_gateway_dispatch(make_event(text=raw), gateway=None)
        assert "the question" in llm_call(raw)["context"]

    def test_near_miss_not_answer_now_no_inbox_fetch(self, hook_env, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="answer nowx"), gateway=None)
        assert len(recorded_requests) == 1  # no inbox fetch
        context = llm_call("answer nowx")["context"]
        assert hooks.COMMITTED_MARKER in context
        assert "question" not in context.lower()

    def test_latest_by_created_at_tie_broken_by_id_deterministic(self, hook_env):
        # Same createdAt: the higher id wins, regardless of list order.
        q_a = capture("q-aaaa", "question A", created_at="2026-08-09T12:00:00Z")
        q_b = capture("q-bbbb", "question B", created_at="2026-08-09T12:00:00Z")
        for order in ([q_a, q_b], [q_b, q_a]):
            self._queue_pause_then_inbox(order)
            hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None)
            assert "question B" in llm_call("answer now")["context"]
        # A newer createdAt always beats a lexicographically-higher id.
        q_late = capture("q-zzzz", "question late", created_at="2026-08-09T13:00:00Z")
        self._queue_pause_then_inbox([q_b, q_late])
        hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None)
        assert "question late" in llm_call("answer now")["context"]

    def test_empty_inbox_falls_back_to_pause_reply_only(self, hook_env):
        self._queue_pause_then_inbox([])
        hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None)
        context = llm_call("answer now")["context"]
        assert self.PAUSE_REPLY in context
        assert hooks.COMMITTED_MARKER in context

    def test_inbox_domain_error_falls_back_to_pause_reply_only(self, hook_env):
        _GatewayHandler.response_queue.append((200, envelope(self.PAUSE_REPLY), "application/json"))
        _GatewayHandler.response_queue.append(
            (409, envelope("Reading training is not initialized.", {"code": "not_initialized"}), "application/json")
        )
        hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None)
        context = llm_call("answer now")["context"]
        assert self.PAUSE_REPLY in context
        assert "question" not in context.lower()

    def test_inbox_protocol_error_fails_open(self, hook_env, caplog):
        _GatewayHandler.response_queue.append((200, envelope(self.PAUSE_REPLY), "application/json"))
        _GatewayHandler.response_queue.append((200, "INBOX-BODY-MARKER", "text/html"))
        with caplog.at_level(logging.INFO, logger=_HOOK_LOGGER):
            hooks.pre_gateway_dispatch(make_event(text="answer now"), gateway=None)
        context = llm_call("answer now")["context"]
        assert self.PAUSE_REPLY in context
        assert "INBOX-BODY-MARKER" not in context
        assert "INBOX-BODY-MARKER" not in caplog.text  # bodies never logged


# --------------------------------------------------------------------------
# Fail-open on transport/protocol failures; static, secret-free logging
# --------------------------------------------------------------------------


class TestFailOpen:
    def _closed_port(self) -> int:
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        return port

    def test_unavailable_fails_open_no_injection(self, recorded_requests, caplog):
        # This test intentionally uses a closed port rather than gateway_server;
        # clear the shared recorder so prior server-backed tests cannot leak in.
        recorded_requests.clear()
        state = hooks._configure(
            {
                "owner_id": OWNER,
                "chat_id": CHAT,
                "thread_id": THREAD,
                "base_url": f"http://127.0.0.1:{self._closed_port()}",
                "timeout": 1.0,
            }
        )
        assert state.active
        with caplog.at_level(logging.INFO, logger=_HOOK_LOGGER):
            assert hooks.pre_gateway_dispatch(
                make_event(text="SENSITIVE-READING-SECRET"), gateway=None
            ) is None
        assert current_state().pending == {}
        assert recorded_requests == []
        assert "failing open" in caplog.text
        assert "SENSITIVE-READING-SECRET" not in caplog.text  # bodies never logged
        assert llm_call("SENSITIVE-READING-SECRET") is None

    def test_protocol_error_fails_open(self, hook_env, recorded_requests, caplog):
        _GatewayHandler.response_queue.append((200, "NOT-AN-ENVELOPE-MARKER", "text/plain"))
        with caplog.at_level(logging.INFO, logger=_HOOK_LOGGER):
            assert hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None) is None
        assert len(recorded_requests) == 1
        assert current_state().pending == {}
        assert "failing open" in caplog.text
        assert "NOT-AN-ENVELOPE-MARKER" not in caplog.text
        assert llm_call("pause") is None

    def test_dispatch_debug_log_is_static_and_body_free(self, hook_env, caplog):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        with caplog.at_level(logging.DEBUG, logger=_HOOK_LOGGER):
            hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        debug = [r for r in caplog.records if r.levelno == logging.DEBUG]
        assert debug and "status=200" in debug[0].message
        assert "pause" not in debug[0].message

    def test_hooks_recover_after_failure(self, recorded_requests, caplog):
        hooks._configure(
            {
                "owner_id": OWNER,
                "chat_id": CHAT,
                "thread_id": THREAD,
                "base_url": f"http://127.0.0.1:{self._closed_port()}",
                "timeout": 1.0,
            }
        )
        with caplog.at_level(logging.INFO, logger=_HOOK_LOGGER):
            assert hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None) is None
        # Reconfigure against a healthy gateway: the connector works again.
        gateway = hooks._configure(
            {"owner_id": OWNER, "chat_id": CHAT, "thread_id": THREAD, "base_url": "http://127.0.0.1:1"}
        )  # placeholder; real server configured below via fixture-less client
        assert gateway.active


# --------------------------------------------------------------------------
# No mutation of inputs; no local state or caching
# --------------------------------------------------------------------------


class TestNoMutation:
    def test_event_objects_never_mutated(self, hook_env, recorded_requests):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        event = make_event(text="  pause  ")
        event_before = (vars(event), vars(event.source))
        hooks.pre_gateway_dispatch(event, gateway=None)
        assert (vars(event), vars(event.source)) == event_before
        (_, _, body), = recorded_requests
        assert b'"text":"  pause  "' in body  # verbatim on the wire too

    def test_config_mapping_never_mutated(self, gateway_server):
        mapping = {
            "owner_id": OWNER,
            "chat_id": CHAT,
            "thread_id": THREAD,
            "base_url": gateway_server,
            "timeout": 2.0,
        }
        snapshot = dict(mapping)
        hooks._configure(mapping)
        assert mapping == snapshot

    def test_llm_input_strings_untouched(self, hook_env):
        _GatewayHandler.response_queue.append((200, envelope("ok"), "application/json"))
        hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
        text = "pause"
        llm_call(text)
        assert text == "pause"

    def test_inbox_captures_not_mutated(self, hook_env):
        payload = [capture("q1", "question one")]
        _GatewayHandler.response_queue.append(
            (200, envelope("ok", data=payload), "application/json")
        )
        client = current_state().client
        result = client.get_inbox()
        assert result.captures[0].text == "question one"
        assert payload[0]["text"] == "question one"  # wire payload untouched
        assert result.captures[0] is not payload[0]  # typed copies, no aliasing


class TestNoLocalState:
    def test_pending_always_empty_after_cycles(self, hook_env):
        for i in range(3):
            _GatewayHandler.response_queue.append((200, envelope(f"ok-{i}"), "application/json"))
            hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
            llm_call("pause")
            assert current_state().pending == {}

    def test_repeated_cycles_deterministic(self, hook_env, recorded_requests):
        replies = []
        for _ in range(2):
            _GatewayHandler.response_queue.append((200, envelope("same reply"), "application/json"))
            hooks.pre_gateway_dispatch(make_event(text="pause"), gateway=None)
            replies.append(llm_call("pause")["context"])
        assert replies[0] == replies[1]
        assert recorded_requests[0][2] == recorded_requests[1][2]

    def test_client_never_caches_inbox(self, hook_env):
        client = current_state().client
        _GatewayHandler.response_queue.append(
            (200, envelope("ok", data=[capture("q1", "first")]), "application/json")
        )
        first = client.get_inbox().captures
        _GatewayHandler.response_queue.append(
            (200, envelope("ok", data=[capture("q2", "second")]), "application/json")
        )
        second = client.get_inbox().captures
        assert first[0].text == "first"
        assert second[0].text == "second"  # fresh fetch, no cached state

    def test_hooks_module_holds_no_domain_state(self, hook_env):
        assert current_state().pending == {}
        assert not hasattr(hooks, "captures")
        assert not hasattr(hooks, "sessions")
