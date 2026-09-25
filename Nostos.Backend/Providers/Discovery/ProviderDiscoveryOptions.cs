namespace Nostos.Backend.Providers.Discovery;

/// <summary>Resource bounds for aggregate provider discovery.</summary>
public sealed class ProviderDiscoveryOptions
{
    public const string SectionName = "ProviderDiscovery";

    public static readonly TimeSpan DefaultSearchTimeout = TimeSpan.FromSeconds(12);

    /// <summary>
    /// Hard deadline for one provider participating in aggregate discovery.
    /// Non-positive values fall back to the finite default.
    /// </summary>
    public TimeSpan SearchTimeout { get; set; } = DefaultSearchTimeout;

    public TimeSpan EffectiveSearchTimeout =>
        SearchTimeout > TimeSpan.Zero
            ? SearchTimeout
            : DefaultSearchTimeout;
}
