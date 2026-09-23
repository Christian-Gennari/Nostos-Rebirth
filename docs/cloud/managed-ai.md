# Nostos Cloud managed AI

Issues #404, #405, #406 and #446 define the hosted provider boundary for Ask Nostos and voice transcription while keeping the assistant, its tools, usage accounting and the domain model shared with SelfHosted.

## Deployment behavior

| Surface | SelfHosted | Cloud |
| --- | --- | --- |
| Ask Nostos LLM | Owner-configured provider/BYOK through the existing AI-provider settings | Nostos-managed LLM through Vercel AI Gateway |
| Voice transcription | Owner-configured STT through the existing provider settings | Nostos-managed Groq transcription |
| Provider endpoint/model/key UI/API | Owner may configure it | Operator-managed; customer provider-setting requests are rejected |
| Tool registry/orchestration | Shared AssistantOrchestrator | Shared AssistantOrchestrator |
| Per-turn execution policy | #406 | #406 |
| Subscription entitlement | Not required | #403 ManagedAiEnabled |
| Monthly usage/rate limits | N/A to Nostos-funded usage | #405 |

Cloud does not create a second assistant, tool registry, or Library/Brain implementation. Provider selection happens in backend composition.

## Managed LLM

Cloud uses Vercel AI Gateway as an OpenAI-compatible intermediary:

    base URL: https://ai-gateway.vercel.sh/v1
    endpoint: /chat/completions
    model: google/gemini-3.8-flash
    reasoning_effort: low

The current upstream model is Gemini 3.8 Flash, but neither the assistant orchestration nor the Nostos domain depends on Gemini-specific SDK types. The model remains operator-configurable server-side.

Nostos uses raw HTTP against the OpenAI-compatible endpoint; the Vercel AI SDK is not required. The managed Cloud provider and the existing SelfHosted 9Router provider share the OpenAI-compatible request/response serializer while keeping their configuration and error policies separate.

Server configuration lives under CloudManagedAi:

    CloudManagedAi:LlmEnabled
    CloudManagedAi:LlmBaseUrl
    CloudManagedAi:LlmModel
    CloudManagedAi:LlmThinkingLevel
    CloudManagedAi:LlmApiKeyEnvironmentVariable
    CloudManagedAi:LlmRequestTimeoutSeconds

The retained LlmThinkingLevel configuration key maps to the OpenAI-compatible request field reasoning_effort. The default is low and is sent explicitly on every request; Nostos does not rely on a provider default.

The default credential variable is:

    NOSTOS_CLOUD_AI_GATEWAY_API_KEY

Changing the managed model or other operator settings requires only server configuration/restart, not a frontend release. These values are not accepted from assistant requests or customer provider-settings APIs, and the browser never receives the Gateway credential.

### Tool calling and provider round state

The OpenAI-compatible transport serializes the existing Nostos tool definitions as function tools and preserves tool-call IDs through the AssistantOrchestrator loop.

Some upstream models routed through a gateway attach opaque metadata to an assistant tool-call message. For example, Gemini may attach a thought signature beneath an extra_content field. Nostos stores the raw assistant message as opaque LlmCompletion.ProviderState for a tool-call completion and replays that message on the following tool round.

This is deliberately generic: the orchestrator does not know about Google, Vercel or thought-signature field names. Unknown provider message fields survive the round-trip without becoming application/domain concepts.

### Usage metadata

The adapter maps OpenAI-compatible usage fields into the existing Nostos completion model:

- prompt_tokens -> LlmCompletion.PromptTokens;
- completion_tokens -> LlmCompletion.CompletionTokens;
- completion_tokens_details.reasoning_tokens -> LlmCompletion.ThinkingTokens;
- when completion_tokens is absent but prompt_tokens and total_tokens are present, output tokens fall back to total_tokens - prompt_tokens.

completion_tokens is treated as the provider-reported billed output total. Reasoning tokens remain separately observable and are not added to completion tokens a second time.

AssistantExecutionMeter then feeds the same dimensions into #405 managed-AI accounting and #406 per-turn budget controls. No prompt, reply, tool arguments, or tool results are added to usage telemetry.

## Managed voice transcription

Cloud voice transcription remains direct to Groq's OpenAI-compatible transcription endpoint with:

    model: whisper-large-v3-turbo

Server configuration:

    CloudManagedAi:SttEnabled
    CloudManagedAi:SttBaseUrl
    CloudManagedAi:SttModel
    CloudManagedAi:SttApiKeyEnvironmentVariable
    CloudManagedAi:SttRequestTimeoutSeconds

The default credential variable remains:

    NOSTOS_CLOUD_GROQ_API_KEY

GroqManagedSttProvider implements the existing ISTtProvider boundary. Audio is streamed from the existing transcription endpoint to Groq and is not deliberately persisted by Nostos after transcription. The browser never receives the Groq key.

SelfHosted continues to use NineRouterSttProvider and its existing owner-configurable settings unchanged.

## Entitlement and usage boundaries

In Cloud, both Ask Nostos turns and voice transcription check #403's effective entitlement before spending a managed provider call:

    CloudAccess && ManagedAiEnabled

#405 persists managed usage, enforces monthly allowances and short-window rate limits, and applies operator/global spend ceilings. #446 does not create a second accounting path: the Gateway provider reports usage through the existing LlmCompletion dimensions consumed by AssistantExecutionMeter.

SelfHosted bypasses Cloud entitlement and managed-spend accounting because it remains BYOK.

## #406 execution policy

The managed Gateway path uses the same AssistantOrchestrator and preserves the measured per-turn policy from #406:

- upstream-call safety ceiling: **6**;
- cumulative reported-token ceiling: **50,000**;
- wall-clock ceiling: **60,000 ms**;
- estimated per-turn cost ceiling: **$0.05**;
- stop before executing an immediately repeated equivalent tool batch;
- stop immediately at approval-required and required-user-input boundaries;
- never claim unfinished work completed after budget exhaustion;
- record content-free execution metrics only.

The managed provider itself does not add hidden transport retries or silently route to a fallback provider. One ILlmProvider.CompleteAsync call sends one upstream Gateway request.

## Failure behavior

Cloud returns product-level errors rather than exposing upstream secrets or diagnostics:

| Condition | HTTP behavior |
| --- | --- |
| Account lacks managed-AI entitlement | 403, managed AI not included |
| Managed provider disabled/missing operator credential | 503, temporarily unavailable |
| Provider rejects Nostos's credential | 502 |
| Provider rate limit | 429 |
| Provider timeout | 504 |
| Invalid/unexpected upstream response | 502 |
| Other provider/gateway outage | 502 |
| Per-turn #406 budget exhausted | existing deterministic execution-limit response |
| Managed STT unavailable | typed STT 503/429/504/502 equivalent |

Provider URLs, API keys, authorization headers, raw upstream error bodies, and internal secret names are not returned to the browser.

## Privacy/provider boundary

Managed AI is optional product functionality. When a Cloud user invokes Ask Nostos, content needed to answer the turn—including relevant conversation/context and tool-loop messages—is sent by the Nostos backend through Vercel AI Gateway to the configured managed model provider. When the user invokes voice transcription, the uploaded audio is sent by the Nostos backend directly to Groq.

Nostos does not add prompt/content logging for metering. Provider selection, privacy terms, retention behavior, and any customer-facing disclosure should be reviewed whenever the operator changes the managed route.

## Secret and external setup requirements

No provider credential belongs in appsettings.json, source control, Angular configuration, or a customer database.

A Cloud runtime needs these server-side secret values:

    NOSTOS_CLOUD_AI_GATEWAY_API_KEY=<Vercel AI Gateway credential>
    NOSTOS_CLOUD_GROQ_API_KEY=<Groq API credential>

The previous direct-Gemini variable is no longer read by managed Cloud LLM runtime code:

    NOSTOS_CLOUD_GEMINI_API_KEY  ->  NOSTOS_CLOUD_AI_GATEWAY_API_KEY

Rotate/deploy the new variable before removing the old value from an operator secret store. No secret value should be committed.

Secret injection remains hosting-vendor-neutral. The runtime contract in docs/cloud/runtime.md describes how hosted credentials are supplied to the stateless application container.

## Relationship to adjacent Cloud work

- **#403** defines whether the account is entitled to managed AI.
- **#404** introduced zero-setup managed LLM/STT composition.
- **#405** owns usage persistence, monthly quota enforcement, rate limits, price epochs, and global/operator budgets.
- **#406** owns the measured per-turn execution budget and stop policy.
- **#407** owns the broader Settings presentation/adaptation.
- **#401** owns container/stateless runtime and secret-injection architecture.
- **#446** routes the managed LLM through Vercel AI Gateway without changing Ask Nostos product behavior.
