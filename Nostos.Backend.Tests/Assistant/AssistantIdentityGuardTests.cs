using FluentAssertions;
using Nostos.Backend.Integrations.Assistant;
using Xunit;

namespace Nostos.Backend.Tests.Assistant;

/// <summary>
/// The pure identity guard (286-S1b, corrected by 286-S1c). A first-person
/// marker alone is not enough: detection fires only on a direct self-naming, a
/// vendor-made passive, or a creator assertion, and leaves an ordinary
/// first-person reply or a bare mention untouched.
/// </summary>
public sealed class AssistantIdentityGuardTests
{
    [Theory]
    [InlineData("I am Gemini, a large language model built by Google. How can I help you today?")]
    [InlineData("I'm Claude, made by Anthropic.")]
    [InlineData("I am a large language model built by Google.")]
    [InlineData("I'm an AI assistant made by OpenAI.")]
    [InlineData("As an AI built by Anthropic, I can't help with that.")]
    [InlineData("My creator is Google.")]
    public void An_identity_assertion_is_replaced_with_the_canonical_line(string reply)
    {
        var guarded = AssistantIdentityGuard.Apply(reply);

        guarded.Should().Be(AssistantIdentityGuard.CanonicalIdentityLine);
        guarded.Should().NotMatchRegex("(?i)(Gemini|Google|OpenAI|ChatGPT|Claude|Anthropic|DeepSeek|GPT)");
    }

    [Theory]
    [InlineData("I am linking this note to your Claude Shannon collection.")]
    [InlineData("I'm not finding a note about Microsoft.")]
    [InlineData("I am looking through the Google Books entries in your library.")]
    [InlineData("I'm adding it to your Anthropic research collection.")]
    [InlineData("I found three notes about Anthropic's research papers.")]
    [InlineData("Your note mentions Claude Lévi-Strauss.")]
    [InlineData("Here is what your library says about Google's search algorithm.")]
    [InlineData("I captured that note against page 183.")]
    [InlineData("That passage is about the history of the printing press.")]
    public void A_first_person_action_or_a_mention_without_an_identity_claim_is_left_alone(string reply)
    {
        AssistantIdentityGuard.Apply(reply).Should().Be(reply);
    }

    [Fact]
    public void A_vendor_term_in_a_different_sentence_from_the_first_person_claim_is_left_alone()
    {
        const string reply = "I am reading your notes. One of them was written by Google.";

        AssistantIdentityGuard.Apply(reply).Should().Be(reply);
    }

    [Fact]
    public void The_canonical_line_itself_names_no_vendor()
    {
        AssistantIdentityGuard.CanonicalIdentityLine.Should().NotMatchRegex(
            "(?i)(Gemini|Google|OpenAI|ChatGPT|Claude|Anthropic|DeepSeek|GPT)");
    }
}
