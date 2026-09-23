namespace Nostos.Backend.Services.Ai;

public interface IManagedAiAccessPolicy
{
    Task<bool> IsAllowedAsync(CancellationToken ct = default);
}

/// <summary>SelfHosted remains BYOK and never requires a Nostos subscription.</summary>
public sealed class SelfHostedManagedAiAccessPolicy : IManagedAiAccessPolicy
{
    public Task<bool> IsAllowedAsync(CancellationToken ct = default) => Task.FromResult(true);
}
