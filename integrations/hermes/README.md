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

## Not yet deployed

This source tree does **not** install the plugin, change Hermes configuration, restart the gateway, disable the old reading coach, or migrate data. Live notification delivery with acknowledge-after-confirmed-send is also a later slice. Deployment and cutover require the remaining end-to-end acceptance gates.
