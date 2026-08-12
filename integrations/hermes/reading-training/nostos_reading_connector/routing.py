"""Pure, deterministic routing primitives for the optional Nostos
reading connector (Task 10B1).

This module contains NO I/O, NO randomness, and NO reading-training domain
state. It decides only two things, both from the message scope and hygiene:

* whether the configured connector is active at all (exact owner id,
  ``platform`` in {telegram, discord}, exact chat id, and — for Telegram —
  an exact numeric thread id), and
* whether an inbound message is *eligible* to be forwarded verbatim to the
  Nostos gateway (``POST /api/reading/gateway/dispatch``).

Scope and hygiene decisions are exact and deterministic:

* accepted only when owner/platform/chat/thread all match a configured scope
  exactly (Discord scopes may be channel-level: no thread required);
* rejected: every other chat/topic/sender, every slash command, bot/self and
  generated/outgoing messages, synthetic async-delegation deliveries,
  cron deliveries, empty text, and messages without a trusted event id.

The gateway classifier on the Nostos side decides whether an eligible message
is a canonical control, a verbatim capture, or ``gateway_ignored`` — this
module deliberately does NOT duplicate command grammar or any live session
state (no active-session flag, no timing, no progression). The pre-model hook
(in a later slice) forwards eligible messages to the gateway, which consults
Nostos's authoritative state.

Message idempotency: the stable ``idempotencyKey`` derives from the trusted
platform message id via :func:`idempotency_key`. A missing event id is
rejected (``missing_event_id`` / :class:`MissingEventIdError`) — a random or
generated key is never produced.

Field mapping (verified against Hermes plugin hook conventions, legacy
``pre_gateway_dispatch(event, gateway)`` / ``pre_llm_call(...)``):

* ``platform``  <- ``event.source.platform`` (``.value`` for enums)
* ``sender_id`` <- ``event.user_id`` or ``event.source.user_id``
* ``chat_id``   <- ``event.source.chat_id``
* ``thread_id`` <- ``event.source.thread_id`` (None when the chat has no topic)
* ``chat_topic``<- ``event.source.chat_topic`` (label; carried for
  completeness but NEVER used in any decision — routing matches the exact
  numeric thread id, never a topic label)
* ``message_id``<- ``event.message_id`` or ``event.source.message_id``
* ``text``      <- ``event.text``

Synthetic/cron markers (verified in current Hermes source): async delegation
completions arrive as ``[ASYNC DELEGATION ...`` (e.g. ``[ASYNC DELEGATION
BATCH COMPLETE — ...]``), operator steering as ``[OUT-OF-BAND ...``, and cron
deliveries are framed as ``[Cron delivery: <name>]\\n<text>``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Union

PLATFORM_TELEGRAM = "telegram"
PLATFORM_DISCORD = "discord"

VALID_PLATFORMS = (PLATFORM_TELEGRAM, PLATFORM_DISCORD)
"""Platforms this connector can route for. Telegram scopes require an exact
numeric thread; Discord scopes may be channel-level (thread optional)."""

DEFAULT_CLIENT_ID = "nostos-telegram"
"""Default connector identity used as the dispatch ``clientId``."""

DEFAULT_DISCORD_CLIENT_ID = "nostos-discord"
"""Default connector identity for Discord scopes."""

DEFAULT_KEY_NAMESPACE = "nostos-reading"
"""Namespace prefix for deterministic idempotency keys."""

# Synthetic async-delegation / operator-steering delivery prefixes. Prefix
# matching covers both the legacy and the current Hermes renderings
# (``[ASYNC DELEGATION BATCH COMPLETE — ...]``, ``[OUT-OF-BAND USER
# MESSAGE — ...]``). These deliveries are never reading input.
SYNTHETIC_DELIVERY_PREFIXES = ("[ASYNC DELEGATION", "[OUT-OF-BAND")

# Cron deliveries are framed with a ``[Cron delivery: <name>]`` header
# (hermes cron/scheduler.py). They land in the configured delivery thread
# and must never be treated as user input.
CRON_DELIVERY_PREFIX = "[Cron delivery:"

# Stable non-eligible reason codes (the hook maps these to a silent no-op).
REASON_INACTIVE_CONFIG = "inactive_config"
REASON_WRONG_PLATFORM = "wrong_platform"
REASON_NOT_OWNER = "not_owner"
REASON_WRONG_CHAT = "wrong_chat"
REASON_WRONG_THREAD = "wrong_thread"
REASON_OUTGOING_MESSAGE = "outgoing_message"
REASON_BOT_SENDER = "bot_sender"
REASON_NO_TEXT = "no_text"
REASON_SLASH_COMMAND = "slash_command"
REASON_SYNTHETIC_DELIVERY = "synthetic_delivery"
REASON_CRON_DELIVERY = "cron_delivery"
REASON_MISSING_EVENT_ID = "missing_event_id"


class MissingEventIdError(ValueError):
    """Raised when an idempotency key is requested without a trusted event id.

    Idempotency keys must derive from a trusted platform message/turn id;
    this module never fabricates a random or synthetic key.
    """


def _positive_int(value: Any) -> Optional[int]:
    """Coerce an int or a plain digit string to a positive int; else None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isascii() and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else None
    return None


@dataclass(frozen=True)
class ConnectorConfig:
    """Exact routing scope for the optional reading connector.

    ``chat_id`` / ``thread_id`` accept an ``int`` or a plain digit string
    (config sources may deliver either); anything else makes the config
    inactive. ``owner_id`` is compared as its exact string form. The config
    is *inactive* when any field is missing/invalid — the connector then
    fails open (all messages keep their ordinary Hermes path).

    Platform rules:

    * ``telegram`` — ``thread_id`` REQUIRED (Reading forum topic), exact match.
    * ``discord`` — ``thread_id`` OPTIONAL: a channel-level scope (thread_id
      unset) accepts any message in the channel; a thread-level scope
      (thread_id set) accepts only that thread.
    """

    owner_id: Union[str, int]
    chat_id: Union[str, int]
    thread_id: Optional[Union[str, int]] = None
    platform: str = PLATFORM_TELEGRAM
    client_id: str = DEFAULT_CLIENT_ID

    @property
    def active(self) -> bool:
        return is_active(self)

    @property
    def is_telegram(self) -> bool:
        return self.platform == PLATFORM_TELEGRAM

    @property
    def is_discord(self) -> bool:
        return self.platform == PLATFORM_DISCORD


@dataclass(frozen=True)
class InboundMessage:
    """Metadata record of an inbound gateway message (hook-supplied fields).

    See the module docstring for the exact ``pre_gateway_dispatch`` /
    ``pre_llm_call`` field mapping. ``chat_topic`` is accepted because hooks
    supply it, but is deliberately never consulted by any routing decision.
    """

    platform: str
    sender_id: Optional[Union[str, int]]
    chat_id: Optional[Union[str, int]]
    text: Optional[str]
    message_id: Optional[Union[str, int]] = None
    thread_id: Optional[Union[str, int]] = None
    chat_topic: Optional[str] = None
    is_outgoing: bool = False
    is_bot: bool = False


@dataclass(frozen=True)
class RoutingDecision:
    """Outcome of :func:`classify`.

    ``eligible`` messages carry the exact original ``text`` (never stripped or
    otherwise modified) and a deterministic ``idempotency_key`` derived from
    the trusted platform message id. Non-eligible messages carry a stable
    ``reason`` code and no key.
    """

    eligible: bool
    reason: Optional[str] = None
    text: Optional[str] = None
    idempotency_key: Optional[str] = None


def config_issues(config: ConnectorConfig) -> tuple[str, ...]:
    """Return the field names that make ``config`` inactive (empty = active)."""
    if config.platform not in VALID_PLATFORMS:
        return ("platform",)
    if isinstance(config.owner_id, bool) or not isinstance(
        config.owner_id, (str, int)
    ) or str(config.owner_id).strip() == "":
        return ("owner_id",)
    if _positive_int(config.chat_id) is None:
        return ("chat_id",)
    if config.is_telegram:
        # Telegram scopes are forum-topic scopes: the numeric thread is
        # mandatory (a Telegram channel without a topic is not a Reading
        # scope for this connector).
        if _positive_int(config.thread_id) is None:
            return ("thread_id",)
    else:
        # Discord scopes may be channel-level (thread_id unset) or
        # thread-level; an invalid non-empty thread is still a config error.
        if config.thread_id is not None and _positive_int(config.thread_id) is None:
            return ("thread_id",)
    if not isinstance(config.client_id, str) or config.client_id.strip() == "":
        return ("client_id",)
    return ()


def is_active(config: ConnectorConfig) -> bool:
    """True when the config carries an exact, valid routing scope."""
    return not config_issues(config)


def idempotency_key(
    message: InboundMessage, *, namespace: str = DEFAULT_KEY_NAMESPACE
) -> str:
    """Deterministic, namespaced idempotency key from the trusted message id.

    Format: ``<namespace>:<platform>:<chat_id>:<message_id>``. Telegram
    message ids are unique per chat, so the pair (chat_id, message_id) is
    stable for replaying the same message. Raises :class:`MissingEventIdError`
    when no trusted event id is present — a random key is never generated.
    """
    message_id = message.message_id
    if message_id is None or str(message_id).strip() == "":
        raise MissingEventIdError(
            "idempotency key requires a trusted platform message id; "
            "refusing to generate a synthetic key"
        )
    return f"{namespace}:{message.platform}:{message.chat_id}:{message_id}"


def classify(config: ConnectorConfig, message: InboundMessage) -> RoutingDecision:
    """Classify one inbound message for the configured connector.

    Pure and deterministic. Returns ``eligible`` only when the config is
    active, the scope matches exactly (owner/platform/chat/thread), and the
    message is ordinary inbound human text with a trusted event id. Slash
    commands, synthetic async/cron deliveries, bot/self/outgoing messages,
    empty text, and missing event ids are rejected with a stable reason.

    The decision never inspects command grammar or reading-session state:
    whether an eligible message is a control, a capture, or ``gateway_ignored``
    is decided by Nostos's gateway dispatcher.
    """
    if not is_active(config):
        return RoutingDecision(False, REASON_INACTIVE_CONFIG)
    if message.platform != config.platform:
        return RoutingDecision(False, REASON_WRONG_PLATFORM)
    if str(message.sender_id or "") != str(config.owner_id):
        return RoutingDecision(False, REASON_NOT_OWNER)
    if str(message.chat_id or "") != str(config.chat_id):
        return RoutingDecision(False, REASON_WRONG_CHAT)
    if config.is_telegram:
        # Telegram: exact numeric thread required (forum topic scope).
        if str(message.thread_id or "") != str(config.thread_id):
            return RoutingDecision(False, REASON_WRONG_THREAD)
    elif config.thread_id is not None:
        # Discord thread-level scope: exact thread match.
        if str(message.thread_id or "") != str(config.thread_id):
            return RoutingDecision(False, REASON_WRONG_THREAD)
    # Discord channel-level scope (thread_id unset): any message in the
    # channel is in scope, threads included.
    if message.is_outgoing:
        return RoutingDecision(False, REASON_OUTGOING_MESSAGE)
    if message.is_bot:
        return RoutingDecision(False, REASON_BOT_SENDER)
    text = message.text
    if text is None or text.strip() == "":
        return RoutingDecision(False, REASON_NO_TEXT)
    if text.startswith("/"):
        return RoutingDecision(False, REASON_SLASH_COMMAND)
    if text.startswith(SYNTHETIC_DELIVERY_PREFIXES):
        return RoutingDecision(False, REASON_SYNTHETIC_DELIVERY)
    if text.startswith(CRON_DELIVERY_PREFIX):
        return RoutingDecision(False, REASON_CRON_DELIVERY)
    if message.message_id is None or str(message.message_id).strip() == "":
        return RoutingDecision(False, REASON_MISSING_EVENT_ID)
    return RoutingDecision(
        True,
        text=text,
        idempotency_key=idempotency_key(message),
    )
