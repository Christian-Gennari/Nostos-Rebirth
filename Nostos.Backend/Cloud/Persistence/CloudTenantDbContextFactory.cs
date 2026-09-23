using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Data;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Persistence;

/// <summary>
/// Keeps the existing IDbContextFactory seam while selecting the customer
/// database only from a trusted server-side account identity.
///
/// HTTP requests derive that identity from the validated principal. Background
/// work must explicitly push a trusted account into the ambient background
/// context; no database name, account id or storage namespace is accepted from
/// request data.
/// </summary>
public sealed class CloudTenantDbContextFactory : IDbContextFactory<NostosDbContext>
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ICloudAccountContextResolver _accountResolver;
    private readonly ICloudControlPlaneStore _controlPlane;
    private readonly ICloudCustomerConnectionFactory _customerConnections;
    private readonly CloudBackgroundTenantContextAccessor? _backgroundTenant;

    public CloudTenantDbContextFactory(
        IHttpContextAccessor httpContextAccessor,
        ICloudAccountContextResolver accountResolver,
        ICloudControlPlaneStore controlPlane,
        ICloudCustomerConnectionFactory customerConnections,
        CloudBackgroundTenantContextAccessor? backgroundTenant = null)
    {
        _httpContextAccessor = httpContextAccessor;
        _accountResolver = accountResolver;
        _controlPlane = controlPlane;
        _customerConnections = customerConnections;
        _backgroundTenant = backgroundTenant;
    }

    public NostosDbContext CreateDbContext() =>
        CreateDbContextAsync(CancellationToken.None).AsTask().GetAwaiter().GetResult();

    public async ValueTask<NostosDbContext> CreateDbContextAsync(
        CancellationToken cancellationToken = default)
    {
        var account = ResolveAccount();

        var mapping = await _controlPlane.FindAsync(account.AccountId, cancellationToken)
            ?? throw new InvalidOperationException(
                "The trusted Cloud account has not been provisioned.");

        if (!mapping.IsReady)
        {
            throw new InvalidOperationException(
                $"The trusted Cloud account is not ready (state: {mapping.ProvisioningState}).");
        }

        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(_customerConnections.ForDatabase(mapping.DatabaseName))
            .Options;

        return new NostosDbContext(options);
    }

    private NostosAccountContext ResolveAccount()
    {
        if (_backgroundTenant?.Current is { } background)
            return background;

        var httpContext = _httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException(
                "A Cloud customer database was requested outside an authenticated HTTP request. " +
                "Background Cloud work must carry an explicit trusted account context.");

        if (!_accountResolver.TryResolve(httpContext.User, out var account) || account is null)
        {
            throw new InvalidOperationException(
                "A Cloud customer database was requested without a trusted authenticated account identity.");
        }

        return account;
    }
}
