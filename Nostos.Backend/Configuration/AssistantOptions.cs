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
/// The default <see cref="Model"/> is the 9Router free pool, verbatim. The
/// reference (`.hermes/plans/assistant-milestone/reference/9router-free-pool.md`)
/// forbids any paid/premium model anywhere in this path; do not "tidy" the id.
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
    /// Model id sent verbatim — the 9Router free pool. Measured quirks this
    /// forces on the provider (explicit <c>stream:false</c>, generous
    /// <c>max_tokens</c>, empty-content/<c>length</c> as data) are documented in
    /// the reference; never normalize or rewrite this value.
    /// </summary>
    public string Model { get; set; } =
        "free_frontier_pooled_gemini_gemini_3.8_flash__kr_claude_sonnet_4.5__openrouter_nex_agi_nex_n2.5_pro_free__kgw_nex_agi_nex_n2.5_pro_free__openrouter_inclusionai_ling_3.0_flash_vl_free";

    /// <summary>Name of the environment variable holding the bearer token.</summary>
    public string ApiKeyEnvironmentVariable { get; set; } = "NOSTOS_ASSISTANT_TOKEN";

    /// <summary>
    /// RETIRED as an effective value (issue #262 §7): the capture
    /// post-processing mode now comes from the stored assistant setting, which
    /// the owner chooses once in Settings. This property is kept only so an
    /// existing <c>appsettings.json</c> keeps binding — nothing reads it. With
    /// no stored row, the effective mode is <c>verbatim</c>.
    /// </summary>
    public string DefaultProcessingMode { get; set; } = "verbatim";

    /// <summary>
    /// Hard ceiling on LLM round trips in one turn. A model that keeps asking for
    /// tools is cut off rather than looping forever.
    /// </summary>
    public int MaxToolIterations { get; set; } = 6;

    /// <summary>
    /// Per-LLM-call ceiling. The pool spends reasoning tokens even on trivial
    /// answers, so this is generous on purpose.
    /// </summary>
    public int RequestTimeoutSeconds { get; set; } = 90;
}
