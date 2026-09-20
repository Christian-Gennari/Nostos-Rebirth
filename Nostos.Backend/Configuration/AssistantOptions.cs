namespace Nostos.Backend.Configuration;

/// <summary>
/// Assistant LLM bridge configuration (issue #261 §3, decision D2/D8).
///
/// Optional and disabled by default, exactly like <see cref="McpOptions"/> and
/// <see cref="SpeechOptions"/>: with <see cref="Enabled"/> false the endpoint is
/// still mapped, but answers with a typed "disabled" error rather than calling a
/// provider or 500-ing. The credential is never read from configuration — only
/// the NAME of the environment variable that holds it — so the key cannot be
/// committed and cannot be shipped to the Angular client.
///
/// The default <see cref="Model"/> is the 9Router free pool, verbatim. The
/// reference (`.hermes/plans/assistant-milestone/reference/9router-free-pool.md`)
/// forbids any paid/premium model anywhere in this path; do not "tidy" the id.
/// </summary>
public sealed class AssistantOptions
{
    public const string SectionName = "Assistant";

    /// <summary>Master switch. When false the endpoints are typed no-ops.</summary>
    public bool Enabled { get; set; } = false;

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
