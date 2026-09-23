namespace Nostos.Backend.Services.Ai;

public enum ManagedAiUsageKind
{
    Llm,
    Stt,
}

public enum ManagedAiUsageBlockReason
{
    NotEntitled,
    RateLimited,
    MonthlyAllowanceExhausted,
    OperatorDisabled,
    OperatorBudgetExhausted,
}

public sealed class ManagedAiUsageException(
    ManagedAiUsageBlockReason reason,
    string message) : Exception(message)
{
    public ManagedAiUsageBlockReason Reason { get; } = reason;
}

public sealed record ManagedAiUsageLease(Guid ReservationId, ManagedAiUsageKind Kind);

public sealed record ManagedAiLlmUsage(
    int UpstreamRequestCount,
    int? InputTokens,
    int? OutputTokens,
    int? ThinkingTokens,
    int? ReportedTotalTokens,
    int ToolLoopIterations,
    string ResultCategory,
    string? ProviderFinishReason);

public sealed record ManagedAiSttUsage(
    int UpstreamRequestCount,
    double? DurationSeconds,
    string ResultCategory);

public static class ManagedAiUsageStates
{
    public const string NotApplicable = "not_applicable";
    public const string NotIncluded = "not_included";
    public const string Normal = "normal";
    public const string NearLimit = "near_limit";
    public const string Exhausted = "exhausted";
    public const string TemporarilyUnavailable = "temporarily_unavailable";
}

public sealed record ManagedAiUsageStatus(
    string State,
    DateTime? RenewsAtUtc);

/// <summary>
/// Product-facing usage boundary. The normal request path never supplies an
/// account id; Cloud implementations derive it from the trusted tenant context.
/// </summary>
public interface IManagedAiUsageService
{
    Task<ManagedAiUsageLease?> BeginLlmTurnAsync(CancellationToken cancellationToken = default);
    Task CompleteLlmTurnAsync(
        ManagedAiUsageLease? lease,
        ManagedAiLlmUsage usage,
        CancellationToken cancellationToken = default);

    Task<ManagedAiUsageLease?> BeginSttAsync(CancellationToken cancellationToken = default);
    Task CompleteSttAsync(
        ManagedAiUsageLease? lease,
        ManagedAiSttUsage usage,
        CancellationToken cancellationToken = default);

    Task<ManagedAiUsageStatus> GetStatusAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// SelfHosted is BYOK. It never consults Cloud subscriptions, usage records,
/// operator budgets, or a network service merely to decide whether local AI may run.
/// </summary>
public sealed class SelfHostedManagedAiUsageService : IManagedAiUsageService
{
    public static SelfHostedManagedAiUsageService Instance { get; } = new();

    public Task<ManagedAiUsageLease?> BeginLlmTurnAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<ManagedAiUsageLease?>(null);

    public Task CompleteLlmTurnAsync(
        ManagedAiUsageLease? lease,
        ManagedAiLlmUsage usage,
        CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<ManagedAiUsageLease?> BeginSttAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<ManagedAiUsageLease?>(null);

    public Task CompleteSttAsync(
        ManagedAiUsageLease? lease,
        ManagedAiSttUsage usage,
        CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<ManagedAiUsageStatus> GetStatusAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new ManagedAiUsageStatus(ManagedAiUsageStates.NotApplicable, null));
}
