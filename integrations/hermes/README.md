# Optional Hermes Reading Training connector

This directory contains the source for a thin, stateless Hermes connector to the Nostos Reading Training API. Nostos remains the sole authority for sessions, captures, receipts, books, reviews, and notifications.

## Behaviour

The plugin registers `pre_gateway_dispatch` and `pre_llm_call` hooks. It only considers inbound human Telegram messages when owner ID, chat ID, and numeric thread ID exactly match configuration. It rejects slash commands, bot/outgoing messages, cron deliveries, synthetic delegation messages, and every other chat or topic.

An eligible message is forwarded once, verbatim, to:

```text
POST /api/reading/gateway/dispatch
```

The idempotency key is deterministically namespaced from the trusted Telegram message ID. A successful authoritative result is carried into the same turn as ephemeral `ACTION_ALREADY_COMMITTED` context so the model replies without repeating the mutation. `gateway_ignored` leaves the ordinary model/MCP path untouched. `answer now` pauses authoritatively, then reads the unresolved inbox and injects the latest saved Question for normal discussion. Transport or protocol failure fails open without local state or fallback mutations.

## Configuration

The manifest is `reading-training/plugin.yaml`. After installing the directory as a Hermes plugin, configure its entry under `plugins.entries.reading-training`:

```yaml
plugins:
  entries:
    reading-training:
      owner_id: "<telegram-user-id>"
      platform: telegram
      chat_id: <telegram-chat-id>
      thread_id: <numeric-reading-topic-id>
      base_url: http://127.0.0.1:5214
      timeout: 5.0
      client_id: nostos-telegram
```

No IDs or credentials are tracked in this repository. Missing or invalid configuration makes the plugin an inert no-op and emits one startup warning.

## Verification

From the repository root:

```bash
/home/dev/.hermes/hermes-agent/venv/bin/python -m pytest integrations/hermes/reading-training/tests -q
/home/dev/.hermes/hermes-agent/venv/bin/python -m py_compile \
  integrations/hermes/reading-training/__init__.py \
  integrations/hermes/reading-training/nostos_reading_connector/*.py
```

The tests exercise the real Hermes `PluginContext`/`PluginManager`, synthetic plugin-loader import shape, exact routing, raw HTTP wire contract, idempotency, answer-now retrieval, fail-open behaviour, no retries, redirect rejection, and credential-safe URL handling.

## Deployment and cutover

This source tree never installs or enables itself. Deploy only after the Nostos REST, MCP, and connector suites pass:

1. Copy `integrations/hermes/reading-training/` to the active Hermes profile's plugin directory as `reading-training`.
2. Configure the exact owner, platform, chat, numeric Reading thread, Nostos base URL, timeout, and client ID. Keep MCP bearer tokens in environment-backed secret configuration; the connector itself carries no credential.
3. Enable `reading-training`, disable the legacy `reading-coach`, and restart the Hermes gateway so the hook set is reloaded.
4. In the configured Reading topic, send a read-only `status` message and verify its Nostos `stateVersion` matches REST and MCP before accepting mutations.
5. Only then pause legacy reading cron jobs and make the legacy Hermes reading-data directory read-only. Keep the pre-cutover archive and original mode manifest for rollback.

Rollback reverses those steps: stop accepting new Nostos reading mutations, restore legacy file modes/data from the recorded archive, re-enable the old plugin/jobs, disable the connector, and restart Hermes. Never run both state owners as writers.

The v1 connector is inbound and stateless. Optional Telegram delivery of leased Nostos notification-outbox items is not enabled; Nostos continues to own and preserve those rows until a delivery adapter acknowledges them after confirmed send.
