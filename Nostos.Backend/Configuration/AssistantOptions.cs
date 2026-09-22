namespace Nostos.Backend.Configuration;

/// <summary>
/// Assistant LLM bridge configuration (issue #261 §3, decision D2/D8).
///
/// This section is now the FALLBACK for the AI-provider settings: the effective
/// configuration is the stored override when set, otherwise the values here
/// (see <c>IAiProviderConfigResolver</c>). Availability is DERIVED, not a manual
/// server boolean — see <c>EffectiveAiProviderConfig.IsAvailable</c>.
/// <see cref="Enabled"/> is only a hard kill switch and defaults ON, so a
/// configured gateway is usable without anyone editing configuration. When the
/// assistant is unavailable the endpoints are still mapped, but answer with a
/// typed "not configured"/"disabled" error rather than calling a provider or
/// 500-ing. The credential is never read from configuration — only the NAME of
/// the environment variable that holds it — so a committed key is impossible and
/// nothing can be shipped to the Angular client.
///
/// The default <see cref="Model"/> must be a model that ACTUALLY CALLS TOOLS.
/// The 9Router free pool that used to sit here silently ignored the tool
/// definitions: measured against the gateway, the identical request returned
/// <c>finish_reason: "stop"</c> with zero tool calls, so every capture, search
/// and suggestion the assistant described had in fact not run. Do not put a
/// pooled/multi-vendor id back here without proving tool calling works.
/// </summary>
public sealed class AssistantOptions
{
    public const string SectionName = "Assistant";

    /// <summary>
    /// Hard kill switch. Defaults ON: readiness (a configured key and base URL)
    /// is what actually decides whether the assistant runs, so the feature is
    /// not dead just because nobody flipped a server boolean. Set false only to
    /// take the assistant down entirely.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Base URL of the OpenAI-compatible gateway, INCLUDING the <c>/v1</c>
    /// suffix. The provider appends <c>chat/completions</c> to it.
    /// </summary>
    public string BaseUrl { get; set; } = "http://omenhub:20128/v1";

    /// <summary>
    /// Model id sent verbatim. It must call tools: capture, reading the
    /// library and proposing concepts all run through tool calls, and a model
    /// that ignores them answers as though it had done the work.
    /// <c>gemini/gemini-3.5-flash-lite</c> is verified calling tools through the
    /// gateway (finish_reason <c>tool_calls</c>, 15 tools offered, ~2.1k prompt
    /// tokens against the pool's ~6.8k of injected preamble).
    /// </summary>
    public string Model { get; set; } = "gemini/gemini-3.5-flash-lite";

    /// <summary>Name of the environment variable holding the bearer token.</summary>
    public string ApiKeyEnvironmentVariable { get; set; } = "NOSTOS_ASSISTANT_TOKEN";

    /// <summary>
    /// Absolute runaway ceiling on upstream LLM calls in one turn, not the normal
    /// UX budget. Issue #406's deterministic scenario sample reaches four calls
    /// for legitimate work; approval/input boundaries and repeated-tool detection
    /// stop earlier. Keep six as defense in depth until the managed Gemini 3.8
    /// Flash low-thinking run supplies provider token/latency/cost distributions.
    /// </summary>
    public int MaxToolIterations { get; set; } = 6;

    /// <summary>
    /// Cumulative provider-reported token ceiling for one turn (prompt + output;
    /// thinking is already inside output). Zero or below disables the ceiling.
    ///
    /// The value is selected from the external Gemini 3.8 Flash low-thinking
    /// measurement in <c>docs/cloud/ask-nostos-execution-budget-spike.md</c> — it
    /// bounds one turn's worst case, not a context window. #405's abuse/rate
    /// limits, #403's monthly entitlement and operator/global emergency ceilings
    /// stay separate.
    /// </summary>
    public int MaxTurnTokens { get; set; }

    /// <summary>
    /// Wall-clock ceiling for one turn in milliseconds. Zero or below disables the
    /// ceiling. Selected from the same external measurement; measured elapsed time
    /// includes provider retry/backoff, which a user experiences as turn latency.
    /// </summary>
    public int MaxTurnElapsedMilliseconds { get; set; }

    /// <summary>
    /// Estimated provider-cost ceiling for one turn in USD, priced with
    /// <see cref="Integrations.Assistant.AssistantPricing"/> at its recorded price
    /// epoch. Zero or below disables the ceiling. Cannot trip while a provider
    /// usage field is missing — an unknown cost is never read as over-budget or as
    /// free.
    /// </summary>
    public decimal MaxTurnEstimatedCostUsd { get; set; }

    /// <summary>
    /// Per-LLM-call ceiling. The pool spends reasoning tokens even on trivial
    /// answers, so this is generous on purpose.
    /// </summary>
    public int RequestTimeoutSeconds { get; set; } = 90;
}
