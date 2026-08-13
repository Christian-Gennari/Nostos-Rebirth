"""Optional Hermes hooks bridging the Telegram Reading topic to Nostos.

Thin, stateless connector layer (Task 10B2). The Nostos backend owns ALL
reading-training state; this module only:

* scopes inbound Telegram messages to the exact configured owner /
  platform / chat / numeric thread (``routing.classify``),
* forwards eligible human text byte-for-byte to
  ``POST /api/reading/gateway/dispatch`` exactly once per event, with a
  deterministic idempotency key derived from the trusted platform message id,
* remembers the authoritative outcome *ephemerally* so the same turn's
  ``pre_llm_call`` can inject unambiguous context telling the model the
  reading action was already committed (``ACTION_ALREADY_COMMITTED``) —
  the stored raw transcript is never altered and the message is never
  ``skip``/``rewrite``-ed,
* special-cases the exact ``answer now`` intent (the ONLY vocabulary mirrored
  here, from ``ReadingGatewayParser.AnswerNowForms``): after an accepted
  pause it fetches the inbox and injects only the deterministically-latest
  unresolved Question for ordinary model discussion.

Fail-open contract: missing/invalid config, ``gateway_ignored`` (422), any
slash/synthetic/cron/bot/outgoing message, and any Nostos transport or
protocol failure leave the message bit-for-bit untouched on its ordinary
Hermes path. No local mutation, no fallback state, no retries, no
notification delivery (a later slice). Error logs are static and never
contain exception details, bodies, or credentials; when Nostos is
unreachable the model/MCP path reports availability instead (see
``integrations/hermes/README.md``).

Hook contract (verified against the local Hermes source):

* ``pre_gateway_dispatch(event, gateway=None, **_)`` — fired once per
  inbound ``MessageEvent`` before auth. Returns ``None`` (allow) for
  everything; ``skip``/``rewrite`` are never used.
* ``pre_llm_call(user_message, turn_id, sender_id, platform, session_id,
  **_)`` — fired once per turn before the model call. Returning
  ``{"context": str}`` injects ephemeral context into the current user
  message only (never the system prompt, never the stored transcript).

The ``pre_llm_call`` scope gate parses the gateway session key
``agent:main:<platform>:<chat_type>:<chat_id>[:<thread_id>]`` (same shape
as ``gateway/run.py:_parse_session_key``), so exact chat/thread matching is
possible even though that hook carries no ``MessageEvent``.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Optional, Tuple

from . import client as _client
from . import routing as _routing

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration contract
# ---------------------------------------------------------------------------
# Read from Hermes config.yaml under ``plugins.entries.<plugin-name>``:
#
#   plugins:
#     entries:
#       reading-training:
#         owner_id: "<telegram user id>"      # required — exact string match
#         chat_id: <telegram chat id>          # required — int or digit string
#         thread_id: <numeric topic thread>    # required (telegram) — int/digit
#         base_url: "http://127.0.0.1:5214"    # optional — Nostos origin
#         timeout: 5.0                         # optional — finite positive
#         client_id: "nostos-telegram"         # optional — dispatch identity
#         platform: "telegram"                 # optional — telegram|discord
#
# Multi-platform setups add a ``scopes`` list (each scope is one exact
# platform/owner/chat/thread scope; ``base_url`` / ``timeout`` stay at the
# top level and are shared):
#
#   plugins:
#     entries:
#       reading-training:
#         base_url: "http://127.0.0.1:5214"
#         timeout: 5.0
#         scopes:
#           - platform: telegram
#             owner_id: "<telegram user id>"
#             chat_id: <telegram chat id>
#             thread_id: <numeric topic thread>
#             client_id: nostos-telegram
#           - platform: discord
#             owner_id: "<discord user id>"
#             chat_id: <discord channel id>
#             client_id: nostos-discord
#
# When ``scopes`` is present it is authoritative; the flat single-scope form
# above is treated as one telegram scope. Discord scopes may omit
# ``thread_id`` (channel-level scope — any message in the channel counts) or
# set it (thread-level scope).
#
# Missing or invalid values make the connector inactive: both hooks become
# cheap no-ops (one clear startup warning) and every message keeps its
# ordinary Hermes path. No secrets live in this repository.

#: Default ``plugins.entries`` key for this plugin's config block.
CONFIG_SECTION = "reading-training"

#: Stable gateway error code for deliberately-ignored input (mirrors
#: ``ReadingGatewayDispatcher.IgnoredCode``).
GATEWAY_IGNORED_CODE = "gateway_ignored"

#: Numeric ``ReadingCaptureDto.type`` for a Question (0 Thought, 1 Question,
#: 2 Bookmark — see ``client.ReadingCapture``).
CAPTURE_TYPE_QUESTION = 1

#: Ephemeral context marker for already-committed reading messages.
COMMITTED_MARKER = "ACTION_ALREADY_COMMITTED"

#: Exact ``answer now`` vocabulary — the ONLY gateway grammar mirrored here.
#: Mirrors ``ReadingGatewayParser.AnswerNowForms`` (case-insensitive on
#: collapsed whitespace; the raw text itself is never rewritten). No other
#: control/capture vocabulary is duplicated: the gateway decides it.
ANSWER_NOW_FORMS = frozenset({"answer now", "answer now please"})


class HookState:
    """Process-local hook state — config, client, and ephemeral correlation.

    Holds zero reading-training domain state. ``configs`` is the tuple of
    exact routing scopes (one per platform/chat/thread), ``pending`` maps
    ``(chat_id, thread_id, sender_id, stripped_text)`` -> ephemeral context
    string for correlating a ``pre_gateway_dispatch`` outcome with the same
    turn's ``pre_llm_call``; entries are created only for messages the
    gateway hook actually dispatched and are consumed/overwritten on the
    next event in the same scope.
    """

    __slots__ = ("configs", "client", "pending", "inactive_reason")

    def __init__(
        self,
        configs: Tuple[_routing.ConnectorConfig, ...],
        client: Optional[_client.NostosClient],
        inactive_reason: str = "",
    ) -> None:
        self.configs = configs
        self.client = client
        self.pending: dict = {}
        self.inactive_reason = inactive_reason

    @property
    def config(self) -> Optional[_routing.ConnectorConfig]:
        """Back-compat: the first configured scope (tests / diagnostics)."""
        return self.configs[0] if self.configs else None

    @property
    def active(self) -> bool:
        return bool(self.configs) and self.client is not None


# Module-level state, replaced by ``_configure`` (called from ``register``
# at plugin load; tests call it directly). The gateway processes messages
# sequentially in one process, so no locking is needed.
_state: Optional[HookState] = None


def _normalize(text: str) -> str:
    """Collapse whitespace + lowercase — identical to the gateway parser's
    recognition normalization (raw text is never rewritten, only compared)."""
    return " ".join(text.lower().split())


def _is_answer_now(text: str) -> bool:
    return _normalize(text) in ANSWER_NOW_FORMS


def _scope_from_mapping(
    scope: Mapping[str, Any],
) -> Tuple[Optional[_routing.ConnectorConfig], str]:
    """Build one routing scope from a flat mapping, plus its inactive reason.

    Returns ``(config, "")`` when the scope parses, else ``(None, reason)``
    naming only the offending fields — never their values.
    """
    if not isinstance(scope, dict):
        return None, "scope entry is not a mapping"
    platform = str(scope.get("platform") or _routing.PLATFORM_TELEGRAM).strip()
    default_client = (
        _routing.DEFAULT_DISCORD_CLIENT_ID
        if platform == _routing.PLATFORM_DISCORD
        else _routing.DEFAULT_CLIENT_ID
    )
    config = _routing.ConnectorConfig(
        owner_id=scope.get("owner_id"),
        chat_id=scope.get("chat_id"),
        thread_id=scope.get("thread_id"),
        platform=platform,
        client_id=scope.get("client_id", default_client),
    )
    issues: list = list(_routing.config_issues(config))
    if issues:
        return None, "invalid config field(s): " + ", ".join(sorted(set(issues)))
    return config, ""


def _config_from_mapping(
    mapping: Optional[Mapping[str, Any]]
) -> Tuple[Tuple[_routing.ConnectorConfig, ...], Optional[_client.NostosClient], str]:
    """Build (configs, client, inactive_reason) from a config mapping.

    Accepts either the flat single-scope form (treated as one telegram
    scope) or a ``scopes`` list (authoritative when present; ``base_url`` /
    ``timeout`` are read from the top level in both forms). Any missing or
    invalid value yields an inactive state with a stable reason string
    naming only the offending fields — never their values.
    """
    if not isinstance(mapping, dict):
        return (), None, f"missing/invalid config entry plugins.entries.{CONFIG_SECTION}"

    base_url = mapping.get("base_url", _client.DEFAULT_BASE_URL)
    timeout = mapping.get("timeout", _client.DEFAULT_TIMEOUT)

    scopes = mapping.get("scopes")
    if isinstance(scopes, list) and scopes:
        raw_scopes: list = list(scopes)
    else:
        # Flat single-scope form -> one telegram scope (legacy behavior).
        raw_scopes = [dict(mapping)]

    configs: list = []
    issues: list = []
    for raw in raw_scopes:
        scope_cfg, reason = _scope_from_mapping(raw)
        if scope_cfg is None:
            issues.append(reason or "invalid scope")
            continue
        configs.append(scope_cfg)
    if not configs:
        return (), None, "; ".join(issues) or "no valid scope"

    base_url_valid = True
    if not isinstance(base_url, str) or not base_url.strip():
        base_url_valid = False
    else:
        try:
            _client.NostosClient(base_url, _client.DEFAULT_TIMEOUT)
        except ValueError:
            base_url_valid = False
    if not base_url_valid:
        issues.append("base_url")

    timeout_valid = not isinstance(timeout, bool) and isinstance(timeout, (int, float))
    if timeout_valid:
        try:
            _client.NostosClient(_client.DEFAULT_BASE_URL, timeout)
        except ValueError:
            timeout_valid = False
    if not timeout_valid:
        issues.append("timeout")

    if issues:
        return (), None, "invalid config field(s): " + ", ".join(sorted(set(issues)))
    return tuple(configs), _client.NostosClient(base_url, timeout), ""


def _configure(mapping: Optional[Mapping[str, Any]] = None) -> HookState:
    """(Re)build the module state from a config mapping.

    ``register`` calls this at plugin load; tests call it directly. An
    inactive result emits exactly one clear warning and makes every hook a
    no-op — no global effects.
    """
    global _state
    configs, client, reason = _config_from_mapping(mapping)
    _state = HookState(configs, client, reason)
    if not _state.active:
        logger.warning(
            "nostos reading connector inactive (%s); all messages keep their ordinary Hermes path",
            reason,
        )
    return _state


def _load_hermes_config(section: str = CONFIG_SECTION) -> Optional[dict]:
    """Read the connector's config block from Hermes config.yaml.

    Imported and called defensively so this package also imports cleanly
    outside a Hermes runtime (tests, diagnostics): any failure means
    "not configured" (inactive), never a crash.
    """
    try:
        from hermes_cli.config import load_config_readonly  # type: ignore[reportMissingImports]

        cfg = load_config_readonly() or {}
    except Exception:
        logger.debug("hermes config not readable; connector inactive", exc_info=True)
        return None
    entries = (cfg.get("plugins") or {}).get("entries") or {}
    entry = entries.get(section)
    if isinstance(entry, dict):
        return dict(entry)
    return None


# ---------------------------------------------------------------------------
# pre_gateway_dispatch
# ---------------------------------------------------------------------------


def _pending_key(message: _routing.InboundMessage) -> Tuple[str, str, str, str]:
    """Correlation key for the ephemeral pending-context map.

    ``text`` is stripped on both sides so the key survives any incidental
    whitespace normalization between the gateway event and the agent turn.
    """
    return (
        str(message.chat_id or ""),
        str(message.thread_id or ""),
        str(message.sender_id or ""),
        (message.text or "").strip(),
    )


def _committed_context(reply: str) -> str:
    """Ephemeral context for an already-handled authoritative outcome."""
    return (
        f"{COMMITTED_MARKER} — Nostos has already handled this reading message "
        "authoritatively (duplicate retries converge; nothing more to perform). "
        "Do not run, repeat, or reinterpret any reading command. "
        f"Reply exactly with Nostos's reply: {reply!r}"
    )


def _answer_now_context(pause_reply: str, question_text: Optional[str]) -> str:
    """Ephemeral context for an accepted ``answer now`` pause.

    Injects only the deterministically-selected saved question for ordinary
    model discussion, or the authoritative pause reply alone when the inbox
    has no unresolved Question. Never fabricates or retains the question.
    """
    if question_text is None:
        return _committed_context(pause_reply)
    return (
        f"{COMMITTED_MARKER} — the reading clock pause was already committed to "
        f"Nostos: {pause_reply!r}. The saved question from the reading inbox is: "
        f"{question_text!r}. Discuss it with the user normally; do not run any "
        "reading command."
    )


def _latest_question(captures: Tuple[_client.ReadingCapture, ...]) -> Optional[str]:
    """Deterministically select the latest unresolved Question.

    From the typed DTOs: latest by ``created_at`` (ISO-8601, lexicographic
    order is chronological for a consistent server), tie-broken by ``id``.
    Returns the verbatim question text, or None when the inbox carries none.
    """
    questions = [
        c for c in captures
        if c.type == CAPTURE_TYPE_QUESTION and not c.resolved and c.text
    ]
    if not questions:
        return None
    latest = max(questions, key=lambda c: (c.created_at, c.id))
    return latest.text


def _message_from_event(event: Any) -> Optional[_routing.InboundMessage]:
    """Extract the routing fields from a gateway ``MessageEvent``.

    Field mapping verified against the local Hermes source (``MessageEvent``
    + ``SessionSource``): ``source.platform`` may be a ``Platform`` enum —
    ``.value`` is read when present; ``user_id``/``message_id`` fall back to
    the source copy; non-string ``text`` (multimodal) is treated as absent.
    """
    source = getattr(event, "source", None)
    if source is None:
        return None
    platform = getattr(source, "platform", None)
    platform = str(getattr(platform, "value", platform) or "")
    text = getattr(event, "text", None)
    if not isinstance(text, str):
        text = None
    return _routing.InboundMessage(
        platform=platform,
        sender_id=getattr(event, "user_id", None) or getattr(source, "user_id", None),
        chat_id=getattr(source, "chat_id", None),
        text=text,
        message_id=getattr(event, "message_id", None)
        or getattr(source, "message_id", None),
        thread_id=getattr(source, "thread_id", None),
        chat_topic=getattr(source, "chat_topic", None),
        is_outgoing=bool(
            getattr(event, "is_outgoing", False) or getattr(source, "is_outgoing", False)
        ),
        is_bot=bool(getattr(source, "is_bot", False)),
    )


def pre_gateway_dispatch(event: Any, gateway: Any = None, **_kwargs: Any) -> Optional[dict]:
    """Route eligible Reading-topic messages to the Nostos gateway.

    One event -> at most one dispatch attempt (the client never retries).
    Returns ``None`` for every message — the event always continues on its
    ordinary path, bit-for-bit untouched. Authoritative outcomes are parked
    in the ephemeral pending map for the same turn's ``pre_llm_call``.
    """
    state = _state
    if state is None or not state.active:
        return None
    client = state.client
    if client is None:
        return None

    message = _message_from_event(event)
    if message is None:
        return None

    # First configured scope that matches the message wins (configs are
    # ordered telegram-first by convention, but matching is scope-exact).
    decision = None
    for config in state.configs:
        decision = _routing.classify(config, message)
        if decision.eligible:
            matched = config
            break
    else:
        return None

    key = _pending_key(message)
    state.pending.pop(key, None)  # one event -> one fresh outcome

    try:
        result = client.dispatch(
            matched.client_id, decision.idempotency_key, decision.text
        )
    except _client.NostosClientError:
        # Fail open: no local mutation, no fallback, no injection. The
        # model/MCP path reports availability (see README). Static log only.
        logger.info(
            "nostos reading connector: Nostos unreachable; failing open "
            "(message keeps its ordinary Hermes path)"
        )
        return None

    logger.debug(
        "nostos reading connector dispatch: status=%s error_code=%s",
        result.http_status,
        result.error_code,
    )

    if result.error_code == GATEWAY_IGNORED_CODE:
        # Model/MCP handles weekly/inbox/book natural language.
        return None

    if _is_answer_now(decision.text) and not result.is_error:
        question_text = None
        try:
            inbox = client.get_inbox()
        except _client.NostosClientError:
            inbox = None
        if inbox is not None and not inbox.is_error:
            question_text = _latest_question(inbox.captures)
        state.pending[key] = _answer_now_context(result.reply, question_text)
        return None

    # Authoritative outcome — fresh command/capture, a duplicate replay of
    # one, a status reply, or a domain rejection: the model must relay
    # Nostos's reply and must not perform anything itself.
    state.pending[key] = _committed_context(result.reply)
    return None


# ---------------------------------------------------------------------------
# pre_llm_call
# ---------------------------------------------------------------------------


def _parse_session_key(session_id: str) -> Optional[dict]:
    """Parse ``agent:main:<platform>:<chat_type>:<chat_id>[:<thread_id>]``.

    Mirrors ``gateway/run.py:_parse_session_key``: ``thread_id`` is only the
    6th element for ``dm``/``thread`` chat types (for group/channel the
    suffix may be a per-user id and is deliberately ignored).
    """
    parts = str(session_id or "").split(":")
    if len(parts) < 5 or parts[0] != "agent" or parts[1] != "main":
        return None
    result = {
        "platform": parts[2],
        "chat_type": parts[3],
        "chat_id": parts[4],
    }
    if len(parts) > 5 and parts[3] in ("dm", "thread"):
        result["thread_id"] = parts[5]
    return result


def _llm_eligible_key(
    state: HookState,
    platform: str,
    sender_id: str,
    session_id: str,
    text: str,
) -> Optional[Tuple[str, str, str, str]]:
    """Exact-scope gate for ``pre_llm_call`` (no MessageEvent available).

    The message-id-free analog of ``routing.classify``: exact owner /
    platform / chat / thread (platform-aware — Telegram requires the exact
    thread, Discord accepts channel-level) from the parsed gateway session
    key plus the same text hygiene (empty/slash/synthetic/cron). Returns
    the pending-map key when the turn is in scope, else None.
    """
    if not isinstance(text, str) or text.strip() == "":
        return None
    if text.startswith("/") or text.startswith(_routing.SYNTHETIC_DELIVERY_PREFIXES):
        return None
    if text.startswith(_routing.CRON_DELIVERY_PREFIX):
        return None
    source = _parse_session_key(session_id)
    if source is None:
        return None
    # First configured scope that matches the session scope wins.
    for config in state.configs:
        if platform != config.platform:
            continue
        if str(sender_id or "") != str(config.owner_id):
            continue
        if source.get("platform") != config.platform:
            continue
        if str(source.get("chat_id") or "") != str(config.chat_id):
            continue
        if config.is_telegram:
            # Telegram: exact numeric thread required (forum topic scope).
            if str(source.get("thread_id") or "") != str(config.thread_id):
                continue
        elif config.thread_id is not None:
            # Discord thread-level scope: exact thread match.
            if str(source.get("thread_id") or "") != str(config.thread_id):
                continue
        # Discord channel-level scope: any session in the channel matches.
        return (
            str(config.chat_id),
            str(source.get("thread_id") or ""),
            str(sender_id or ""),
            text.strip(),
        )
    return None


def pre_llm_call(
    user_message: Any = "",
    turn_id: str = "",
    sender_id: str = "",
    platform: str = "",
    session_id: str = "",
    **_kwargs: Any,
) -> Optional[dict]:
    """Inject ephemeral committed-context into the current turn.

    Only fires for turns whose scope exactly matches the configured Reading
    topic AND whose text has a pending outcome from the same event's
    ``pre_gateway_dispatch``. The entry is consumed on injection (never
    retained); everything else returns ``None`` untouched.
    """
    state = _state
    if state is None or not state.active:
        return None
    if not isinstance(user_message, str):
        return None
    key = _llm_eligible_key(state, platform, sender_id, session_id, user_message)
    if key is None:
        return None
    context = state.pending.pop(key, None)
    if context is None:
        return None
    return {"context": context}


# ---------------------------------------------------------------------------
# Hermes plugin entrypoint
# ---------------------------------------------------------------------------


def register(ctx: Any) -> None:
    """Register both hooks and (re)load the connector config.

    Called by the Hermes plugin loader with a ``PluginContext``. Missing or
    invalid config still registers the hooks — they become cheap no-ops with
    one clear startup warning, so enabling the plugin never affects any
    other chat.
    """
    manifest = getattr(ctx, "manifest", None)
    section = getattr(manifest, "key", None) or CONFIG_SECTION
    _configure(_load_hermes_config(section))
    ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    ctx.register_hook("pre_llm_call", pre_llm_call)
