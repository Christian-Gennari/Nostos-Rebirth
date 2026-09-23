namespace Nostos.Backend.Cloud.Ai;

/// <summary>
/// Content-free provider usage. There are deliberately no prompt, reply, tool
/// argument/result, note/book/writing, or audio fields on this entity.
/// </summary>
public sealed class CloudAiUsageRecord
{
    public long Id { get; set; }
    public Guid AccountId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string? ModelVersion { get; set; }
    public string? PricingEpoch { get; set; }
    public DateTime StartedAtUtc { get; set; }
    public DateTime CompletedAtUtc { get; set; }
    public DateTime PeriodStartUtc { get; set; }
    public int UpstreamRequestCount { get; set; }
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    public int? ThinkingTokens { get; set; }
    public int? ReportedTotalTokens { get; set; }
    public int ToolLoopIterations { get; set; }
    public long? SttDurationMilliseconds { get; set; }
    public long? EstimatedCostMicrousd { get; set; }
    public long QuotaChargeMicrousd { get; set; }
    public string ResultCategory { get; set; } = string.Empty;
    public string? ProviderFinishReason { get; set; }
}

public sealed class CloudAiUsageReservation
{
    public Guid Id { get; set; }
    public Guid AccountId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string? ModelVersion { get; set; }
    public DateTime StartedAtUtc { get; set; }
    public DateTime PeriodStartUtc { get; set; }
    public long ReservedMicrousd { get; set; }
}
