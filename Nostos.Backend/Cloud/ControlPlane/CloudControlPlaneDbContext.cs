using Microsoft.EntityFrameworkCore;

namespace Nostos.Backend.Cloud.ControlPlane;

public sealed class CloudControlPlaneDbContext(DbContextOptions<CloudControlPlaneDbContext> options)
    : DbContext(options)
{
    public DbSet<CloudAccountResource> AccountResources => Set<CloudAccountResource>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var account = modelBuilder.Entity<CloudAccountResource>();

        account.ToTable("AccountResources");
        account.HasKey(x => x.AccountId);

        account.Property(x => x.AccountId)
            .ValueGeneratedNever();

        account.Property(x => x.ResourceId)
            .ValueGeneratedNever();

        account.HasIndex(x => x.ResourceId)
            .IsUnique();

        account.Property(x => x.DatabaseName)
            .HasMaxLength(63)
            .IsRequired();

        account.HasIndex(x => x.DatabaseName)
            .IsUnique();

        account.Property(x => x.StorageNamespace)
            .HasMaxLength(160)
            .IsRequired();

        account.HasIndex(x => x.StorageNamespace)
            .IsUnique();

        account.Property(x => x.ProvisioningState)
            .HasConversion<string>()
            .HasMaxLength(24)
            .IsRequired();

        account.Property(x => x.AccountStatus)
            .HasConversion<string>()
            .HasMaxLength(24)
            .IsRequired();

        account.Property(x => x.SchemaVersion)
            .HasMaxLength(100);

        account.Property(x => x.FailureCode)
            .HasMaxLength(100);

        account.Property(x => x.CreatedAtUtc);
        account.Property(x => x.UpdatedAtUtc);
        account.Property(x => x.LastProvisionAttemptAtUtc);
        account.Property(x => x.ReadyAtUtc);
    }
}

public interface ICloudControlPlaneBootstrapper
{
    Task EnsureReadyAsync(CancellationToken cancellationToken = default);
}

public sealed class CloudControlPlaneBootstrapper(
    IDbContextFactory<CloudControlPlaneDbContext> factory) : ICloudControlPlaneBootstrapper
{
    public async Task EnsureReadyAsync(CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);

        if (!await db.Database.CanConnectAsync(cancellationToken))
        {
            throw new InvalidOperationException(
                "Nostos Cloud cannot connect to the configured control-plane PostgreSQL database.");
        }

        await db.Database.EnsureCreatedAsync(cancellationToken);

        // Force a real query after bootstrap. A connection that exists but has
        // an unexpected/partial schema must fail startup rather than looking healthy.
        _ = await db.AccountResources
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);
    }
}
