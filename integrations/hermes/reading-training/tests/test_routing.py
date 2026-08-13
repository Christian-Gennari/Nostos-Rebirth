"""Tests for the pure routing primitives (exact scope + hygiene, telegram +
discord)."""

from __future__ import annotations

import pytest

from nostos_reading_connector.routing import (
    DEFAULT_DISCORD_CLIENT_ID,
    DEFAULT_KEY_NAMESPACE,
    PLATFORM_DISCORD,
    PLATFORM_TELEGRAM,
    ConnectorConfig,
    InboundMessage,
    MissingEventIdError,
    RoutingDecision,
    classify,
    config_issues,
    idempotency_key,
    is_active,
)

OWNER = "123456789"
CHAT = 987654321
THREAD = 42
DISCORD_OWNER = "987654321012345678"
DISCORD_CHANNEL = 112233445566778899


def config(**overrides) -> ConnectorConfig:
    values: dict[str, object] = dict(
        owner_id=OWNER, chat_id=CHAT, thread_id=THREAD, platform=PLATFORM_TELEGRAM
    )
    values.update(overrides)
    return ConnectorConfig(**values)  # type: ignore[arg-type]


def discord_config(**overrides) -> ConnectorConfig:
    values: dict[str, object] = dict(
        owner_id=DISCORD_OWNER,
        chat_id=DISCORD_CHANNEL,
        thread_id=None,
        platform=PLATFORM_DISCORD,
        client_id=DEFAULT_DISCORD_CLIENT_ID,
    )
    values.update(overrides)
    return ConnectorConfig(**values)  # type: ignore[arg-type]


def message(**overrides) -> InboundMessage:
    values: dict[str, object] = dict(
        platform=PLATFORM_TELEGRAM,
        sender_id=OWNER,
        chat_id=str(CHAT),
        thread_id=str(THREAD),
        text="a thought while reading",
        message_id="1001",
    )
    values.update(overrides)
    return InboundMessage(**values)  # type: ignore[arg-type]


# --------------------------------------------------------------------------
# Config record: active only when the exact scope is present and valid
# --------------------------------------------------------------------------


class TestConfigActive:
    @pytest.mark.parametrize(
        "overrides",
        [
            {},  # canonical ints
            {"chat_id": "987654321", "thread_id": "42"},  # digit strings
            {"owner_id": 123456789},  # numeric owner id
        ],
    )
    def test_active(self, overrides):
        cfg = config(**overrides)
        assert is_active(cfg)
        assert config_issues(cfg) == ()
        assert cfg.active

    @pytest.mark.parametrize(
        "overrides,field",
        [
            ({"platform": "slack"}, "platform"),
            ({"platform": ""}, "platform"),
            ({"owner_id": None}, "owner_id"),
            ({"owner_id": ""}, "owner_id"),
            ({"owner_id": "   "}, "owner_id"),
            ({"owner_id": True}, "owner_id"),
            ({"owner_id": 3.5}, "owner_id"),
            ({"chat_id": None}, "chat_id"),
            ({"chat_id": ""}, "chat_id"),
            ({"chat_id": "abc"}, "chat_id"),
            ({"chat_id": -5}, "chat_id"),
            ({"chat_id": 0}, "chat_id"),
            ({"chat_id": 3.5}, "chat_id"),
            ({"chat_id": True}, "chat_id"),
            ({"chat_id": "12x"}, "chat_id"),
            ({"thread_id": None}, "thread_id"),
            ({"thread_id": ""}, "thread_id"),
            ({"thread_id": "abc"}, "thread_id"),
            ({"thread_id": -1}, "thread_id"),
            ({"thread_id": 0}, "thread_id"),
            ({"thread_id": 2.5}, "thread_id"),
            ({"thread_id": False}, "thread_id"),
            ({"client_id": ""}, "client_id"),
            ({"client_id": "  "}, "client_id"),
        ],
    )
    def test_inactive(self, overrides, field):
        cfg = config(**overrides)
        assert not is_active(cfg)
        assert field in config_issues(cfg)

    def test_discord_channel_scope_active_without_thread(self):
        # Channel-level Discord scope: thread_id unset is valid.
        cfg = discord_config()
        assert is_active(cfg)
        assert config_issues(cfg) == ()
        assert cfg.is_discord
        assert cfg.thread_id is None

    def test_discord_thread_scope_active_with_thread(self):
        cfg = discord_config(thread_id=THREAD)
        assert is_active(cfg)
        assert config_issues(cfg) == ()
        assert cfg.thread_id == THREAD

    def test_discord_scope_invalid_thread(self):
        cfg = discord_config(thread_id="bad")
        assert not is_active(cfg)
        assert "thread_id" in config_issues(cfg)

    def test_discord_scope_invalid_platform(self):
        cfg = discord_config(platform="matrix")
        assert not is_active(cfg)
        assert "platform" in config_issues(cfg)


# --------------------------------------------------------------------------
# Classification: eligible messages
# --------------------------------------------------------------------------


class TestEligible:
    @pytest.mark.parametrize(
        "text",
        [
            "pause",
            "status",
            "this is a normal thought while reading",
            "  leading and trailing whitespace stays  ",
            "Добрый день 👋\nline two",
            "done 42 effort 4 focus 8",
            "thought: something worth saving",
            "a" * 500,  # arbitrarily long
        ],
    )
    def test_eligible_texts(self, text):
        decision = classify(config(), message(text=text))
        assert decision.eligible
        assert decision.reason is None
        assert decision.idempotency_key is not None

    def test_text_preserved_verbatim(self):
        text = "  \tkeep me exactly 👋\nsecond line  "
        decision = classify(config(), message(text=text))
        assert decision.eligible
        assert decision.text == text
        assert decision.text is text  # same object, never copied/stripped

    def test_scope_matches_any_type_representation(self):
        # Config ints + message strings (or vice versa) must match exactly.
        assert classify(config(), message(chat_id=CHAT, thread_id=THREAD)).eligible
        cfg_int = config()
        assert classify(cfg_int, message(chat_id=str(CHAT), thread_id=str(THREAD))).eligible
        assert classify(
            config(chat_id=str(CHAT), thread_id=str(THREAD)), message()
        ).eligible


class TestDiscordEligible:
    def _dmessage(self, **overrides) -> InboundMessage:
        values: dict[str, object] = dict(
            platform=PLATFORM_DISCORD,
            sender_id=DISCORD_OWNER,
            chat_id=str(DISCORD_CHANNEL),
            thread_id=None,
            text="pause",
            message_id="2001",
        )
        values.update(overrides)
        return InboundMessage(**values)  # type: ignore[arg-type]

    def test_channel_level_scope_matches_channel_message(self):
        # No thread on either side: channel-level scope accepts it.
        decision = classify(discord_config(), self._dmessage())
        assert decision.eligible
        assert decision.reason is None

    def test_channel_level_scope_accepts_thread_messages(self):
        # Channel-level scope (thread unset) also accepts messages inside
        # Discord threads in that channel.
        decision = classify(
            discord_config(), self._dmessage(thread_id="999")
        )
        assert decision.eligible

    def test_thread_level_scope_requires_exact_thread(self):
        cfg = discord_config(thread_id=THREAD)
        assert classify(cfg, self._dmessage(thread_id=str(THREAD))).eligible
        decision = classify(cfg, self._dmessage(thread_id="999"))
        assert not decision.eligible
        assert decision.reason == "wrong_thread"
        decision = classify(cfg, self._dmessage(thread_id=None))
        assert not decision.eligible
        assert decision.reason == "wrong_thread"

    def test_wrong_platform_rejected(self):
        decision = classify(discord_config(), self._dmessage(platform="telegram"))
        assert not decision.eligible
        assert decision.reason == "wrong_platform"

    def test_not_owner_rejected(self):
        decision = classify(discord_config(), self._dmessage(sender_id="999"))
        assert not decision.eligible
        assert decision.reason == "not_owner"

    def test_wrong_channel_rejected(self):
        decision = classify(discord_config(), self._dmessage(chat_id="111"))
        assert not decision.eligible
        assert decision.reason == "wrong_chat"

    def test_hygiene_applies_to_discord_too(self):
        assert classify(discord_config(), self._dmessage(text="/start")).reason == "slash_command"
        assert classify(discord_config(), self._dmessage(text="[Cron delivery: x]")).reason == "cron_delivery"
        assert classify(discord_config(), self._dmessage(message_id=None)).reason == "missing_event_id"
        assert classify(discord_config(), self._dmessage(text="")).reason == "no_text"

    def test_discord_client_id_default(self):
        assert discord_config().client_id == DEFAULT_DISCORD_CLIENT_ID


# --------------------------------------------------------------------------
# Classification: scope rejections (exact owner/platform/chat/thread)
# --------------------------------------------------------------------------


class TestScopeRejections:
    def test_wrong_platform(self):
        decision = classify(config(), message(platform="discord"))
        assert not decision.eligible
        assert decision.reason == "wrong_platform"
        assert decision.idempotency_key is None

    def test_not_owner(self):
        decision = classify(config(), message(sender_id="999"))
        assert not decision.eligible
        assert decision.reason == "not_owner"

    def test_not_owner_empty(self):
        decision = classify(config(), message(sender_id=None))
        assert not decision.eligible
        assert decision.reason == "not_owner"

    def test_wrong_chat(self):
        decision = classify(config(), message(chat_id="111111"))
        assert not decision.eligible
        assert decision.reason == "wrong_chat"

    def test_wrong_thread(self):
        decision = classify(config(), message(thread_id="43"))
        assert not decision.eligible
        assert decision.reason == "wrong_thread"

    def test_missing_thread(self):
        decision = classify(config(), message(thread_id=None))
        assert not decision.eligible
        assert decision.reason == "wrong_thread"

    def test_topic_label_never_decides(self):
        # A matching label must NOT make an unbound thread eligible...
        decision = classify(
            config(), message(thread_id="999", chat_topic="Reading")
        )
        assert not decision.eligible
        assert decision.reason == "wrong_thread"
        # ...and the exact numeric thread stays eligible without any label.
        decision = classify(config(), message(chat_topic=None))
        assert decision.eligible

    def test_inactive_config_short_circuits(self):
        decision = classify(config(thread_id="bad"), message())
        assert not decision.eligible
        assert decision.reason == "inactive_config"


# --------------------------------------------------------------------------
# Classification: message hygiene rejections
# --------------------------------------------------------------------------


class TestHygieneRejections:
    @pytest.mark.parametrize(
        "text",
        [
            "/start",
            "/read",
            "/read bind-topic",
            "/restart",
            "/",
            "/pause",
        ],
    )
    def test_slash_commands(self, text):
        decision = classify(config(), message(text=text))
        assert not decision.eligible
        assert decision.reason == "slash_command"

    @pytest.mark.parametrize(
        "text",
        [
            "[ASYNC DELEGATION BATCH COMPLETE — b3b…] background fan-out finished",
            "[ASYNC DELEGATION ...]",
            "[OUT-OF-BAND USER MESSAGE — a direct message from the user]",
            "[OUT-OF-BAND ...]",
        ],
    )
    def test_synthetic_deliveries(self, text):
        decision = classify(config(), message(text=text))
        assert not decision.eligible
        assert decision.reason == "synthetic_delivery"

    @pytest.mark.parametrize(
        "text",
        [
            "[Cron delivery: reading-weekly-review]\nWeek 32 review complete.",
            "[Cron delivery: reading-target-watch]",
        ],
    )
    def test_cron_deliveries(self, text):
        decision = classify(config(), message(text=text))
        assert not decision.eligible
        assert decision.reason == "cron_delivery"

    @pytest.mark.parametrize("text", [None, "", "   ", "\t\n "])
    def test_no_text(self, text):
        decision = classify(config(), message(text=text))
        assert not decision.eligible
        assert decision.reason == "no_text"

    def test_outgoing_generated_message(self):
        decision = classify(config(), message(is_outgoing=True))
        assert not decision.eligible
        assert decision.reason == "outgoing_message"

    def test_bot_sender(self):
        decision = classify(config(), message(is_bot=True))
        assert not decision.eligible
        assert decision.reason == "bot_sender"

    def test_missing_event_id(self):
        decision = classify(config(), message(message_id=None))
        assert not decision.eligible
        assert decision.reason == "missing_event_id"
        assert decision.idempotency_key is None

    def test_unrelated_messages_untouched_reasons(self):
        # Every message outside the exact scope yields a stable rejection the
        # hook maps to a silent no-op (ordinary Hermes processing continues).
        cases = [
            (message(platform="discord"), "wrong_platform"),
            (message(sender_id="someone-else"), "not_owner"),
            (message(chat_id="other-chat"), "wrong_chat"),
            (message(thread_id="other-thread"), "wrong_thread"),
            (message(text="/someslash"), "slash_command"),
            (message(text="[Cron delivery: x]\nbody"), "cron_delivery"),
            (message(text="[ASYNC DELEGATION …]"), "synthetic_delivery"),
            (message(text=""), "no_text"),
        ]
        for msg, expected in cases:
            decision = classify(config(), msg)
            assert not decision.eligible
            assert decision.reason == expected


# --------------------------------------------------------------------------
# Idempotency keys: deterministic, namespaced, never random
# --------------------------------------------------------------------------


class TestIdempotencyKeys:
    def test_format(self):
        assert (
            idempotency_key(message())
            == f"{DEFAULT_KEY_NAMESPACE}:{PLATFORM_TELEGRAM}:{CHAT}:1001"
        )

    def test_deterministic(self):
        first = idempotency_key(message())
        for _ in range(10):
            assert idempotency_key(message()) == first

    def test_differs_by_message_id(self):
        assert idempotency_key(message(message_id="1001")) != idempotency_key(
            message(message_id="1002")
        )

    def test_differs_by_chat(self):
        assert idempotency_key(message(chat_id=CHAT)) != idempotency_key(
            message(chat_id=111)
        )

    def test_namespace_respected(self):
        assert idempotency_key(message(), namespace="other-ns").startswith("other-ns:")
        assert idempotency_key(message(), namespace="other-ns") != idempotency_key(
            message()
        )

    def test_classified_key_matches_function(self):
        decision = classify(config(), message())
        assert decision.eligible
        assert decision.idempotency_key == idempotency_key(message())

    @pytest.mark.parametrize("message_id", [None, "", "   "])
    def test_missing_event_id_rejected_not_generated(self, message_id):
        msg = message(message_id=message_id)
        decision = classify(config(), msg)
        assert not decision.eligible
        assert decision.reason == "missing_event_id"
        with pytest.raises(MissingEventIdError):
            idempotency_key(msg)

    def test_classify_rejects_empty_decision_shape(self):
        # Sanity: rejections never carry a text or key (hook cannot forward).
        decision = classify(config(), message(text="/start"))
        assert isinstance(decision, RoutingDecision)
        assert decision.text is None
        assert decision.idempotency_key is None
