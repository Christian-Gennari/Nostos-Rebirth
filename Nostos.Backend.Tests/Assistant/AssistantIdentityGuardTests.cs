using FluentAssertions;
using Nostos.Backend.Integrations.Assistant;
using Xunit;

namespace Nostos.Backend.Tests.Assistant;

/// <summary>
/// The pure identity guard (286-S1b). Detection must fire on a first-person
/// self-assertion in the same sentence as a vendor/model term, and must not fire
/// on a reply that merely mentions one.
/// </summary>
public sealed class AssistantIdentityGuardTests
{
    [Fact]
    public void The_real_world_vendor_reply_is_replaced_with_the_canonical_line()
    {
        var guarded = AssistantIdentityGuard.Apply(
            "I am Gemini, a large language model built by Google. How can I help you today?");

        guarded.Should().Be(AssistantIdentityGuard.CanonicalIdentityLine);
        guarded.Should().NotMatchRegex("(?i)(Gemini|Google|OpenAI|ChatGPT|Claude|Anthropic|DeepSeek|GPT)");
    }

    [Fact]
    public void A_contracted_first_person_vendor_claim_is_replaced()
    {
        AssistantIdentityGuard.Apply("I'm Claude, made by Anthropic.")
            .Should().Be(AssistantIdentityGuard.CanonicalIdentityLine);
    }

    [Theory]
    [InlineData("Your note mentions Claude Lévi-Strauss.")]
    [InlineData("Here is what your library says about Google's search algorithm.")]
    [InlineData("I found three notes about Anthropic's research papers.")]
    [InlineData("That passage is about the history of the printing press.")]
    public void A_mention_without_a_first_person_identity_claim_is_left_alone(string reply)
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
