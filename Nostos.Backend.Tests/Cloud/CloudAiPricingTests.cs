using FluentAssertions;
using Nostos.Backend.Cloud.Ai;
using Nostos.Backend.Configuration;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Services.Ai;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudAiPricingTests
{
    [Fact]
    public void Gemini_38_flash_uses_versioned_intro_and_2027_epochs_without_double_counting_thinking()
    {
        var intro = CloudAiPricing.EstimateLlm(
            "google",
            "gemini-3.8-flash",
            new DateTime(2026, 12, 31, 23, 59, 59, DateTimeKind.Utc),
            inputTokens: 1_000_000,
            outputTokens: 1_000_000);
        var standard = CloudAiPricing.EstimateLlm(
            "google",
            "gemini-3.8-flash",
            new DateTime(2027, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            inputTokens: 1_000_000,
            outputTokens: 1_000_000);

        intro.Should().Be(new CloudAiCostEstimate(4_500_000, CloudAiPricing.GeminiIntroEpoch));
        standard.Should().Be(new CloudAiCostEstimate(9_000_000, CloudAiPricing.Gemini2027Epoch));
    }

    [Fact]
    public void Groq_whisper_uses_reported_duration_with_the_ten_second_billing_minimum()
    {
        var shortClip = CloudAiPricing.EstimateStt(
            "groq",
            "whisper-large-v3-turbo",
            DateTime.UtcNow,
            durationSeconds: 1.25);
        var minute = CloudAiPricing.EstimateStt(
            "groq",
            "whisper-large-v3-turbo",
            DateTime.UtcNow,
            durationSeconds: 60);

        shortClip.Should().Be(new CloudAiCostEstimate(112, CloudAiPricing.GroqWhisperEpoch));
        minute.Should().Be(new CloudAiCostEstimate(667, CloudAiPricing.GroqWhisperEpoch));
    }

    [Fact]
    public void Unknown_provider_model_or_missing_usage_never_becomes_zero_cost()
    {
        CloudAiPricing.EstimateLlm(
            "google",
            "future-model",
            DateTime.UtcNow,
            100,
            100).Should().BeNull();

        CloudAiPricing.EstimateLlm(
            "google",
            "gemini-3.8-flash",
            DateTime.UtcNow,
            null,
            100).Should().BeNull();

        CloudAiPricing.EstimateStt(
            "groq",
            "future-whisper",
            DateTime.UtcNow,
            10).Should().BeNull();

        CloudAiPricing.EstimateStt(
            "groq",
            "whisper-large-v3-turbo",
            DateTime.UtcNow,
            null).Should().BeNull();
    }

    [Fact]
    public void The_406_per_turn_defaults_remain_authoritative_and_unchanged()
    {
        var options = new AssistantOptions();

        options.MaxToolIterations.Should().Be(6);
        options.MaxTurnTokens.Should().Be(50_000);
        options.MaxTurnElapsedMilliseconds.Should().Be(60_000);
        options.MaxTurnEstimatedCostUsd.Should().Be(0.05m);
    }

    [Fact]
    public async Task SelfHosted_usage_service_bypasses_all_Nostos_funded_limits()
    {
        var service = SelfHostedManagedAiUsageService.Instance;

        (await service.BeginLlmTurnAsync()).Should().BeNull();
        (await service.BeginSttAsync()).Should().BeNull();
        (await service.GetStatusAsync()).State.Should().Be(ManagedAiUsageStates.NotApplicable);

        await service.CompleteLlmTurnAsync(
            null,
            new ManagedAiLlmUsage(99, null, null, null, null, 99, "ProviderError", null));
        await service.CompleteSttAsync(
            null,
            new ManagedAiSttUsage(99, null, "ProviderError"));
    }

    [Fact]
    public void Usage_entities_and_product_contract_contain_no_content_or_provider_secret_fields()
    {
        var entityNames = typeof(CloudAiUsageRecord)
            .GetProperties()
            .Select(x => x.Name)
            .Concat(typeof(CloudAiUsageReservation).GetProperties().Select(x => x.Name))
            .ToList();

        entityNames.Should().NotContain(name =>
            new[] { "Prompt", "Reply", "Content", "Arguments", "Results", "Audio", "Note", "Book", "Writing", "ApiKey", "Secret" }
                .Any(forbidden => name.Contains(forbidden, StringComparison.OrdinalIgnoreCase)));

        typeof(CloudManagedAiUsageEndpoints.CloudManagedAiUsageResponse)
            .GetProperties()
            .Select(x => x.Name)
            .Should().BeEquivalentTo(new[] { "State", "RenewsAtUtc" });
    }
}
