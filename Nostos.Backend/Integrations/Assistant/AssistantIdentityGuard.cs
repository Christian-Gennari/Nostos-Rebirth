using System.Text.RegularExpressions;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// The deterministic backstop behind <see cref="AssistantSoul.Prompt"/>. The
/// assistant is routed through a pool of different vendors, each with its own
/// identity training and its own injected system prompt, so "no vendor or model
/// is ever named in a reply" cannot be guaranteed by a prompt alone. This guard
/// enforces it on the final conversational reply: if the assistant asserts a
/// vendor or model identity about itself, the whole reply is replaced with
/// <see cref="CanonicalIdentityLine"/>.
///
/// Detection is deliberately narrow — a first-person marker in the SAME sentence
/// as a vendor/model term. A reply that merely mentions a vendor term (a
/// quotation, a note title, a search result) is left untouched. The guard is
/// applied to the conversational reply only; note content, quotes, processing
/// results and plan summaries are the user's own words and are never rewritten.
/// </summary>
public static class AssistantIdentityGuard
{
    /// <summary>
    /// The reviewed identity line the guard substitutes when it fires. Exported
    /// so the guard and its tests share one source.
    /// </summary>
    public const string CanonicalIdentityLine =
        "I am the Nostos assistant, here to help you read, think, and work with your library.";

    // Sentence boundaries: the brief's set is sufficient for prose.
    private static readonly Regex SentenceSeparator = new(
        @"[.!?\n]",
        RegexOptions.CultureInvariant);

    // First-person self-assertion markers, matched literally and case-sensitively.
    private static readonly Regex FirstPersonMarker = new(
        @"(I am|I'm|As an AI|As a language model|I was built|I was created|I was trained|my creator|my maker|my developer)",
        RegexOptions.CultureInvariant);

    // Vendor/model terms, case-insensitive word matches. GPT- ends in a
    // non-word character, so it is matched as a prefix (GPT-4, GPT-3.5).
    private static readonly Regex VendorOrModelTerm = new(
        @"\b(Gemini\b|Google\b|OpenAI\b|ChatGPT\b|Claude\b|Anthropic\b|DeepSeek\b|Llama\b|Mistral\b|Copilot\b|Microsoft\b|GPT-)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>
    /// Returns the vendor/model term the reply self-asserts, or null when the
    /// reply makes no first-person identity claim involving one. Used to log
    /// the matched term without ever logging the reply text.
    /// </summary>
    public static string? MatchVendorSelfAssertion(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        foreach (var sentence in SentenceSeparator.Split(text))
        {
            if (!FirstPersonMarker.IsMatch(sentence))
            {
                continue;
            }

            var vendor = VendorOrModelTerm.Match(sentence);
            if (vendor.Success)
            {
                return vendor.Value;
            }
        }

        return null;
    }

    /// <summary>
    /// Returns the reply unchanged, or <see cref="CanonicalIdentityLine"/> when
    /// the reply asserts a vendor/model identity about itself.
    /// </summary>
    public static string Apply(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        return MatchVendorSelfAssertion(text) is null ? text : CanonicalIdentityLine;
    }
}
