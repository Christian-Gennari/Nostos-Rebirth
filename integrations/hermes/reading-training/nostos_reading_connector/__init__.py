"""Optional thin Nostos reading connector — client, routing, and Hermes hooks.

Source-only optional connector (Tasks 10B1 + 10B2). Contains:

* :class:`nostos_reading_connector.client.NostosClient` — a stateless,
  stdlib-only HTTP client for the Nostos reading gateway dispatch route and
  the inbox (plus bounded notification lease/ack wrappers).
* :mod:`nostos_reading_connector.routing` — pure, deterministic Telegram
  routing primitives (exact owner/platform/chat/thread scope + message
  hygiene) and stable idempotency-key derivation.
* :mod:`nostos_reading_connector.hooks` — optional Hermes plugin hooks
  (``pre_gateway_dispatch`` / ``pre_llm_call``) that forward eligible
  Reading-topic text to the Nostos gateway exactly once and inject ephemeral
  committed-command context into the same turn. Missing/invalid config makes
  every hook a safe no-op; the plugin is never required for Nostos to work.

No domain state, no retries, no key generation, no Telegram sending, no
notification delivery, and no Hermes imports at package import time. The
client is a thin transport; the Nostos backend owns all reading-training
state. Deploying this plugin is optional and documented in
``integrations/hermes/README.md``.
"""

from .client import (
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT,
    AckResult,
    CommandResult,
    InboxResult,
    LeasedNotification,
    NostosClient,
    NostosClientError,
    NostosProtocolError,
    NostosUnavailableError,
    ReadingCapture,
)
from .routing import (
    CRON_DELIVERY_PREFIX,
    DEFAULT_CLIENT_ID,
    DEFAULT_KEY_NAMESPACE,
    PLATFORM_TELEGRAM,
    SYNTHETIC_DELIVERY_PREFIXES,
    ConnectorConfig,
    InboundMessage,
    MissingEventIdError,
    RoutingDecision,
    classify,
    config_issues,
    idempotency_key,
    is_active,
)

__all__ = [
    "AckResult",
    "CRON_DELIVERY_PREFIX",
    "CommandResult",
    "ConnectorConfig",
    "DEFAULT_CLIENT_ID",
    "DEFAULT_KEY_NAMESPACE",
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT",
    "InboundMessage",
    "InboxResult",
    "LeasedNotification",
    "MissingEventIdError",
    "NostosClient",
    "NostosClientError",
    "NostosProtocolError",
    "NostosUnavailableError",
    "PLATFORM_TELEGRAM",
    "ReadingCapture",
    "RoutingDecision",
    "SYNTHETIC_DELIVERY_PREFIXES",
    "classify",
    "config_issues",
    "idempotency_key",
    "is_active",
    "register",
]


def register(ctx) -> None:
    """Hermes plugin entrypoint (called by the plugin loader).

    Loads the connector config from ``plugins.entries.reading-training`` in
    Hermes config.yaml and registers both lifecycle hooks. Missing/invalid
    config still registers the hooks — they become safe no-ops with one
    clear startup warning.
    """
    from . import hooks as _hooks

    _hooks.register(ctx)
