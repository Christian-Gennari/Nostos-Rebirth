using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace Nostos.Backend.Security;

public static class NostosCloudClaimTypes
{
    public const string ValidatedIssuer = "nostos:validated_issuer";
}

public readonly record struct NostosAccountId(Guid Value)
{
    public override string ToString() => Value.ToString("D");

    public static NostosAccountId FromExternalIdentity(string issuer, string subject)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(issuer);
        ArgumentException.ThrowIfNullOrWhiteSpace(subject);

        var input = Encoding.UTF8.GetBytes($"nostos-account-v1\0{issuer}\0{subject}");
        var hash = SHA256.HashData(input);
        return new NostosAccountId(new Guid(hash.AsSpan(0, 16)));
    }
}

public sealed record NostosAccountContext(
    NostosAccountId AccountId,
    string DisplayName,
    string? Email);

public interface ICloudAccountContextResolver
{
    bool TryResolve(ClaimsPrincipal principal, out NostosAccountContext? account);
}

public sealed class CloudAccountContextResolver : ICloudAccountContextResolver
{
    public bool TryResolve(ClaimsPrincipal principal, out NostosAccountContext? account)
    {
        account = null;

        if (principal.Identity?.IsAuthenticated != true)
            return false;

        var issuer = principal.FindFirst(NostosCloudClaimTypes.ValidatedIssuer)?.Value;
        var subject = principal.FindFirst("sub")?.Value;

        if (string.IsNullOrWhiteSpace(issuer) || string.IsNullOrWhiteSpace(subject))
            return false;

        var displayName =
            principal.FindFirst("name")?.Value
            ?? principal.FindFirst("preferred_username")?.Value
            ?? principal.FindFirst("email")?.Value
            ?? "Nostos user";

        account = new NostosAccountContext(
            NostosAccountId.FromExternalIdentity(issuer, subject),
            displayName,
            principal.FindFirstValue("email"));

        return true;
    }
}

public interface ICloudTenantContextAccessor
{
    NostosAccountContext GetRequired();
}

/// <summary>
/// Scoped holder for trusted server-side background work that needs to set
/// tenant context outside an HTTP request.
///
/// This is for scheduled operations and internal automation only. Never
/// settable from HTTP input or client-supplied data.
/// </summary>
public sealed class CloudBackgroundTenantContextAccessor
{
    private readonly AsyncLocal<NostosAccountContext?> _current = new();

    public NostosAccountContext? Current => _current.Value;

    public IDisposable Push(NostosAccountContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var previous = _current.Value;
        _current.Value = context;
        return new RestoreScope(this, previous);
    }

    private sealed class RestoreScope(
        CloudBackgroundTenantContextAccessor owner,
        NostosAccountContext? previous) : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
                return;

            owner._current.Value = previous;
            _disposed = true;
        }
    }
}

public sealed class CloudTenantContextScope(
    CloudBackgroundTenantContextAccessor? background = null)
{
    private readonly CloudBackgroundTenantContextAccessor _background =
        background ?? new CloudBackgroundTenantContextAccessor();

    /// <summary>
    /// Pushes a trusted tenant context for the current asynchronous background
    /// flow and restores the previous context on dispose.
    /// </summary>
    public IDisposable Push(NostosAccountContext context) =>
        _background.Push(context);

    /// <summary>
    /// The tenant context for this async flow, if set by trusted server-side
    /// background work.
    /// </summary>
    public NostosAccountContext? Current => _background.Current;
}

public sealed class HttpCloudTenantContextAccessor(
    IHttpContextAccessor httpContextAccessor,
    ICloudAccountContextResolver accountResolver,
    CloudTenantContextScope? scope = null) : ICloudTenantContextAccessor
{
    public NostosAccountContext GetRequired()
    {
        // Trusted server-side background work can set the scope directly.
        if (scope?.Current is not null)
            return scope.Current;

        var httpContext = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("No active HTTP request exists.");

        if (!accountResolver.TryResolve(httpContext.User, out var account) || account is null)
            throw new InvalidOperationException("The request does not contain a trusted Nostos Cloud account identity.");

        return account;
    }
}

public enum CloudAccountStatus
{
    Unknown,
    Active,
    DeletionRequested,
    Disabled,
    Deleted,
}

public interface ICloudAccountStatusStore
{
    ValueTask<CloudAccountStatus> GetStatusAsync(NostosAccountId accountId, CancellationToken cancellationToken);
}

/// <summary>
/// Fail-closed placeholder until #396 wires the Cloud control-plane account store.
/// </summary>
public sealed class UnconfiguredCloudAccountStatusStore : ICloudAccountStatusStore
{
    public ValueTask<CloudAccountStatus> GetStatusAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken) =>
        ValueTask.FromResult(CloudAccountStatus.Unknown);
}
