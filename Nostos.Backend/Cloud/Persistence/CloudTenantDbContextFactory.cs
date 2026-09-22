using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Data;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Persistence;

/// <summary>
/// Keeps the existing IDbContextFactory seam while selecting the customer
/// database only from the authenticated server-side account identity.
///
/// No database name, account id or storage namespace is accepted from an HTTP
/// body/query/header.
/// </summary>
public sealed class CloudTenantDbContextFactory(
    IHttpContextAccessor httpContextAccessor,
    ICloudAccountContextResolver accountResolver,
    ICloudControlPlaneStore controlPlane,
    ICloudCustomerConnectionFactory customerConnections)
    : IDbContextFactory<NostosDbContext>
{
    public NostosDbContext CreateDbContext() =>
        CreateDbContextAsync(CancellationToken.None).AsTask().GetAwaiter().GetResult();

    public async ValueTask<NostosDbContext> CreateDbContextAsync(
        CancellationToken cancellationToken = default)
    {
        var httpContext = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException(
                "A Cloud customer database was requested outside an authenticated HTTP request. " +
                "Background Cloud work must carry an explicit trusted account context.");

        if (!accountResolver.TryResolve(httpContext.User, out var account) || account is null)
        {
            throw new InvalidOperationException(
                "A Cloud customer database was requested without a trusted authenticated account identity.");
        }

        var mapping = await controlPlane.FindAsync(account.AccountId, cancellationToken)
            ?? throw new InvalidOperationException(
                "The authenticated Cloud account has not been provisioned.");

        if (!mapping.IsReady)
        {
            throw new InvalidOperationException(
                $"The authenticated Cloud account is not ready (state: {mapping.ProvisioningState}).");
        }

        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(mapping.DatabaseName))
            .Options;

        return new NostosDbContext(options);
    }
}
