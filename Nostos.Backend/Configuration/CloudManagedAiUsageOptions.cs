namespace Nostos.Backend.Configuration;

/// <summary>
/// Server-authoritative safeguards around Nostos-funded managed AI. These are
/// operational controls, not plan marketing copy, and can be changed through
/// normal runtime configuration without a frontend or code release.
/// </summary>
public sealed class CloudManagedAiUsageOptions
{
    public const string SectionName = "CloudManagedAiUsage";

    /// <summary>Emergency operator switch. False blocks new managed provider spend.</summary>
    public bool OperatorEnabled { get; set; } = true;

    /// <summary>
    /// Global calendar-month provider-spend ceiling in micro-USD
    /// (1 USD = 1,000,000 micro-USD). Zero is a deliberate hard stop.
    /// </summary>
    public long GlobalMonthlyBudgetMicrousd { get; set; } = 100_000_000;

    public int RateWindowSeconds { get; set; } = 60;
    public int LlmRequestsPerWindow { get; set; } = 20;
    public int SttRequestsPerWindow { get; set; } = 10;

    /// <summary>
    /// Conservative STT reservation before provider duration is known.
    /// The normal voice endpoint is capped at five minutes.
    /// </summary>
    public int SttReservationSeconds { get; set; } = 300;

    public int NearLimitPercent { get; set; } = 80;

    public static CloudManagedAiUsageOptions FromConfiguration(IConfiguration configuration)
    {
        var options =
            configuration.GetSection(SectionName).Get<CloudManagedAiUsageOptions>()
            ?? new CloudManagedAiUsageOptions();
        options.Validate();
        return options;
    }

    public void Validate()
    {
        if (GlobalMonthlyBudgetMicrousd < 0)
            throw new InvalidOperationException($"{SectionName}:GlobalMonthlyBudgetMicrousd cannot be negative.");
        if (RateWindowSeconds is < 1 or > 3600)
            throw new InvalidOperationException($"{SectionName}:RateWindowSeconds must be between 1 and 3600.");
        if (LlmRequestsPerWindow is < 1 or > 10_000)
            throw new InvalidOperationException($"{SectionName}:LlmRequestsPerWindow must be between 1 and 10000.");
        if (SttRequestsPerWindow is < 1 or > 10_000)
            throw new InvalidOperationException($"{SectionName}:SttRequestsPerWindow must be between 1 and 10000.");
        if (SttReservationSeconds is < 10 or > 3600)
            throw new InvalidOperationException($"{SectionName}:SttReservationSeconds must be between 10 and 3600.");
        if (NearLimitPercent is < 1 or > 99)
            throw new InvalidOperationException($"{SectionName}:NearLimitPercent must be between 1 and 99.");
    }
}
