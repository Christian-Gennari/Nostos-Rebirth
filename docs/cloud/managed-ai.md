# Nostos Cloud managed AI

Issue #404 provides the hosted provider boundary for Ask Nostos and voice transcription while keeping the assistant, its tools, and the domain model shared with SelfHosted.

## Deployment behavior

| Surface | SelfHosted | Cloud |
| --- | --- | --- |
| Ask Nostos LLM | Owner-configured provider/BYOK through the existing AI-provider settings | Nostos-managed Gemini |
| Voice transcription | Owner-configured STT through the existing provider settings | Nostos-managed Groq transcription |
| Provider endpoint/model/key UI/API | Owner may configure it | Operator-managed; customer provider-setting requests are rejected |
| Tool registry/orchestration | Shared AssistantOrchestrator | Shared AssistantOrchestrator |
| Per-turn execution policy | #406 | #406 |
| Subscription entitlement | Not required | #403 ManagedAiEnabled |
| Monthly usage/rate limits | N/A to Nostos-funded usage | Deferred to #405 |

Cloud does not create a second assistant, tool registry, or Library/Brain implementation. Provider selection happens in backend composition.

## Managed LLM

The initial Cloud LLM is Google's native Gemini API:

    model: gemini-3.8-flash
    thinking level: low

The thinking level is sent explicitly on every request as provider configuration; Nostos does not rely on the Gemini default.

Server configuration lives under CloudManagedAi:

    CloudManagedAi:LlmEnabled
    CloudManagedAi:LlmBaseUrl
    CloudManagedAi:LlmModel
    CloudManagedAi:LlmThinkingLevel
    CloudManagedAi:LlmApiKeyEnvironmentVariable
    CloudManagedAi:LlmRequestTimeoutSeconds

The default credential variable is:

    NOSTOS_CLOUD_GEMINI_API_KEY

Changing the managed model or other operator settings requires only server configuration/restart, not a frontend release. These values are not accepted from assistant requests or customer provider-settings APIs.

GeminiManagedLlmProvider implements the existing ILlmProvider boundary. Native Gemini function calls are translated to the shared Nostos tool-call representation. Opaque provider round state is carried through LlmCompletion.ProviderState so Gemini thought signatures can be replayed on a following tool round without putting Gemini-specific state into the orchestrator.

### Usage metadata

The adapter surfaces:

- provider finish reason;
- prompt/input token count;
- output token count;
- thinking token count when reported.

Gemini reports visible candidate tokens and thinking tokens separately. LlmCompletion.CompletionTokens is normalized to the provider-billed output total (prefer totalTokenCount - promptTokenCount, otherwise candidate + thinking when both are available) while ThinkingTokens remains separately observable. This preserves #406's existing total-token and price calculations without charging thinking twice and gives #405 raw usage dimensions to account later.

No prompt, reply, tool arguments, or tool results are added to execution metrics.

## Managed voice transcription

Cloud voice transcription uses Groq's direct OpenAI-compatible transcription endpoint with:

    model: whisper-large-v3-turbo

Server configuration:

    CloudManagedAi:SttEnabled
    CloudManagedAi:SttBaseUrl
    CloudManagedAi:SttModel
    CloudManagedAi:SttApiKeyEnvironmentVariable
    CloudManagedAi:SttRequestTimeoutSeconds

The default credential variable is:

    NOSTOS_CLOUD_GROQ_API_KEY

GroqManagedSttProvider implements the existing ISTtProvider boundary. Audio is streamed from the existing transcription endpoint to the provider and is not deliberately persisted by Nostos after transcription. The browser never receives the Groq key.

SelfHosted continues to use NineRouterSttProvider and its existing owner-configurable settings unchanged.

## Entitlement boundary

In Cloud, both Ask Nostos turns and voice transcription check #403's effective entitlement before spending a managed provider call:

    CloudAccess && ManagedAiEnabled

A denied account receives a product-level 403 and the provider is not called.

The ManagedAiMonthlyAllowance number is deliberately not consumed or decremented here. A zero allowance is not interpreted as "already exhausted" by #404 because account usage, monthly enforcement, short-window rate limits, and operator/global spend ceilings belong to #405.

SelfHosted bypasses the Cloud entitlement boundary.

## #406 execution policy

The managed Gemini path uses the same AssistantOrchestrator and preserves the measured per-turn policy from #406:

- upstream-call safety ceiling: **6**;
- cumulative reported-token ceiling: **50,000**;
- wall-clock ceiling: **60,000 ms**;
- estimated per-turn cost ceiling: **$0.05**;
- stop before executing an immediately repeated equivalent tool batch;
- stop immediately at approval-required and required-user-input boundaries;
- never claim unfinished work completed after budget exhaustion;
- record content-free execution metrics only.

The managed provider itself does not add hidden transport retries or silently route to a fallback provider. One ILlmProvider.CompleteAsync call sends one upstream Gemini request.

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
| Other provider outage | 502 |
| Per-turn #406 budget exhausted | existing deterministic execution-limit response |
| Managed STT unavailable | typed STT 503/429/504/502 equivalent |

There is no automatic fallback provider in #404.

Provider URLs, API keys, raw upstream error bodies, and sensitive diagnostics are not returned to the browser.

## Privacy/provider boundary

Managed AI is optional product functionality. When a Cloud user invokes Ask Nostos, content needed to answer the turn—including relevant conversation/context and tool-loop messages—is sent by the Nostos backend to the configured managed LLM provider. When the user invokes voice transcription, the uploaded audio is sent by the Nostos backend to the configured managed STT provider.

Nostos does not add prompt/content logging for metering. The #406 execution telemetry is content-free.

Provider selection, provider privacy terms, retention behavior, and any customer-facing disclosure should be reviewed whenever the operator changes the configured managed provider.

## Secret and external setup requirements

No provider credential belongs in appsettings.json, source control, Angular configuration, or a customer database.

A Cloud runtime needs these server-side secret values:

    NOSTOS_CLOUD_GEMINI_API_KEY=<Google Gemini API credential>
    NOSTOS_CLOUD_GROQ_API_KEY=<Groq API credential>

Secret injection is intentionally hosting-vendor-neutral. Issue #401 may change how runtime secrets are supplied without changing #404's provider contracts.

The repository does not provision Google or Groq accounts/projects. The operator must create/authorize those provider credentials externally and inject the two values above into the hosted runtime.

## Relationship to adjacent Cloud work

- **#403** defines whether the account is entitled to managed AI.
- **#404** makes the managed LLM/STT work with zero customer provider setup.
- **#405** owns usage persistence, monthly quota enforcement, rate limits, price epochs, and global/operator budgets.
- **#406** owns the already-measured per-turn execution budget and stop policy.
- **#407** owns the broader Settings presentation/adaptation.
- **#401** owns container/stateless runtime and the general secret-injection architecture.

#404 does not provision DigitalOcean, Neon, B2, Clerk, Paddle, Google, or Groq infrastructure.
