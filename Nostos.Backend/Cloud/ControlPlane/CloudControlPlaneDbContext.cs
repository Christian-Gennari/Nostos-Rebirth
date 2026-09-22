using Microsoft.EntityFrameworkCore;

namespace Nostos.Backend.Cloud.ControlPlane;

public sealed class CloudControlPlaneDbContext(DbContextOptions<CloudControlPlaneDbContext> options)
    : DbContext(options)
{
    public DbSet<CloudAccountResource> AccountResources => Set<CloudAccountResource>();
    public DbSet<CloudSubscription> Subscriptions => Set<CloudSubscription>();
    public DbSet<CloudSubscriptionAuditEvent> SubscriptionAudit => Set<CloudSubscriptionAuditEvent>();

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

        var subscription = modelBuilder.Entity<CloudSubscription>();

        subscription.ToTable("CloudSubscriptions");
        subscription.HasKey(x => x.AccountId);

        subscription.Property(x => x.AccountId)
            .ValueGeneratedNever();

        subscription.Property(x => x.PlanId)
            .HasMaxLength(64)
            .IsRequired();

        subscription.Property(x => x.Status)
            .HasConversion<string>()
            .HasMaxLength(24)
            .IsRequired();

        subscription.Property(x => x.EntitlementsJson)
            .HasColumnType("jsonb")
            .IsRequired();

        subscription.Property(x => x.TrialEndsAtUtc);
        subscription.Property(x => x.GraceEndsAtUtc);
        subscription.Property(x => x.UpdatedAtUtc);

        subscription
            .HasOne<CloudAccountResource>()
            .WithOne()
            .HasForeignKey<CloudSubscription>(x => x.AccountId)
            .OnDelete(DeleteBehavior.Restrict);

        var audit = modelBuilder.Entity<CloudSubscriptionAuditEvent>();

        audit.ToTable("CloudSubscriptionAudit");
        audit.HasKey(x => x.Id);

        audit.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        audit.Property(x => x.PlanId)
            .HasMaxLength(64)
            .IsRequired();

        audit.Property(x => x.Status)
            .HasConversion<string>()
            .HasMaxLength(24)
            .IsRequired();

        audit.Property(x => x.EntitlementsJson)
            .HasColumnType("jsonb")
            .IsRequired();

        audit.Property(x => x.ChangeSource)
            .HasMaxLength(64)
            .IsRequired();

        audit.Property(x => x.ReconciliationReference)
            .HasMaxLength(160);

        audit.Property(x => x.TrialEndsAtUtc);
        audit.Property(x => x.GraceEndsAtUtc);
        audit.Property(x => x.ChangedAtUtc);

        audit.HasIndex(x => new { x.AccountId, x.ChangedAtUtc });

        audit
            .HasOne<CloudAccountResource>()
            .WithMany()
            .HasForeignKey(x => x.AccountId)
            .OnDelete(DeleteBehavior.Restrict);
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
        await EnsureCommercialSchemaAsync(db, cancellationToken);

        // Force real queries after bootstrap. A connection that exists but has
        // an unexpected/partial schema must fail startup rather than looking healthy.
        _ = await db.AccountResources
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);

        _ = await db.Subscriptions
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);

        _ = await db.SubscriptionAudit
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);
    }

    private static async Task EnsureCommercialSchemaAsync(
        CloudControlPlaneDbContext db,
        CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "CloudSubscriptions" (
                "AccountId" uuid NOT NULL,
                "PlanId" character varying(64) NOT NULL,
                "Status" character varying(24) NOT NULL,
                "EntitlementsJson" jsonb NOT NULL,
                "TrialEndsAtUtc" timestamp with time zone NULL,
                "GraceEndsAtUtc" timestamp with time zone NULL,
                "UpdatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_CloudSubscriptions" PRIMARY KEY ("AccountId"),
                CONSTRAINT "FK_CloudSubscriptions_AccountResources_AccountId"
                    FOREIGN KEY ("AccountId") REFERENCES "AccountResources" ("AccountId")
                    ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS "CloudSubscriptionAudit" (
                "Id" bigint GENERATED BY DEFAULT AS IDENTITY,
                "AccountId" uuid NOT NULL,
                "PlanId" character varying(64) NOT NULL,
                "Status" character varying(24) NOT NULL,
                "EntitlementsJson" jsonb NOT NULL,
                "TrialEndsAtUtc" timestamp with time zone NULL,
                "GraceEndsAtUtc" timestamp with time zone NULL,
                "ChangeSource" character varying(64) NOT NULL,
                "ReconciliationReference" character varying(160) NULL,
                "ChangedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_CloudSubscriptionAudit" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_CloudSubscriptionAudit_AccountResources_AccountId"
                    FOREIGN KEY ("AccountId") REFERENCES "AccountResources" ("AccountId")
                    ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS "IX_CloudSubscriptionAudit_AccountId_ChangedAtUtc"
                ON "CloudSubscriptionAudit" ("AccountId", "ChangedAtUtc");
            """,
            cancellationToken);
    }
}
