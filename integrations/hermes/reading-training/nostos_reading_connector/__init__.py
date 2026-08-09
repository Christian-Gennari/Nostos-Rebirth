"""Optional thin Nostos reading connector — client and routing primitives.

Source-only package (Task 10B1). Contains:

* :class:`nostos_reading_connector.client.NostosClient` — a stateless,
  stdlib-only HTTP client for the Nostos reading gateway dispatch route and
  the inbox (plus bounded notification lease/ack wrappers).
* :mod:`nostos_reading_connector.routing` — pure, deterministic Telegram
  routing primitives (exact owner/platform/chat/thread scope + message
  hygiene) and stable idempotency-key derivation.

No domain state, no retries, no key generation, no Telegram sending, no
Hermes imports, and no plugin wiring (``plugin.yaml``/hooks/deploy arrive in
later slices). The client is a thin transport; the Nostos backend owns all
reading-training state.
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
]
