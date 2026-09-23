using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.Ai;

namespace Nostos.Backend.Cloud.ControlPlane;

public sealed class CloudControlPlaneDbContext(DbContextOptions<CloudControlPlaneDbContext> options)
    : DbContext(options)
{
    public DbSet<CloudAccountResource> AccountResources => Set<CloudAccountResource>();
    public DbSet<CloudSubscription> Subscriptions => Set<CloudSubscription>();
    public DbSet<CloudSubscriptionAuditEvent> SubscriptionAudit => Set<CloudSubscriptionAuditEvent>();
    public DbSet<Nostos.Backend.Cloud.Billing.CloudBillingBinding> BillingBindings =>
        Set<Nostos.Backend.Cloud.Billing.CloudBillingBinding>();
    public DbSet<Nostos.Backend.Cloud.Billing.CloudBillingEventReceipt> BillingEvents =>
        Set<Nostos.Backend.Cloud.Billing.CloudBillingEventReceipt>();
    public DbSet<CloudAiUsageRecord> AiUsage => Set<CloudAiUsageRecord>();
    public DbSet<CloudAiUsageReservation> AiUsageReservations => Set<CloudAiUsageReservation>();

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

        var billingBinding =
            modelBuilder.Entity<Nostos.Backend.Cloud.Billing.CloudBillingBinding>();

        billingBinding.ToTable("CloudBillingBindings");
        billingBinding.HasKey(x => x.AccountId);
        billingBinding.Property(x => x.Provider).HasMaxLength(32).IsRequired();
        billingBinding.Property(x => x.ExternalTransactionId).HasMaxLength(64);
        billingBinding.Property(x => x.ExternalCustomerId).HasMaxLength(64);
        billingBinding.Property(x => x.ExternalSubscriptionId).HasMaxLength(64);
        billingBinding.Property(x => x.LastEventOccurredAtUtc);
        billingBinding.Property(x => x.UpdatedAtUtc);
        billingBinding
            .HasIndex(x => new { x.Provider, x.ExternalSubscriptionId })
            .IsUnique();
        billingBinding
            .HasOne<CloudAccountResource>()
            .WithOne()
            .HasForeignKey<Nostos.Backend.Cloud.Billing.CloudBillingBinding>(x => x.AccountId)
            .OnDelete(DeleteBehavior.Restrict);

        var billingEvent =
            modelBuilder.Entity<Nostos.Backend.Cloud.Billing.CloudBillingEventReceipt>();

        billingEvent.ToTable("CloudBillingEvents");
        billingEvent.HasKey(x => new { x.Provider, x.EventId });
        billingEvent.Property(x => x.Provider).HasMaxLength(32).IsRequired();
        billingEvent.Property(x => x.EventId).HasMaxLength(96).IsRequired();
        billingEvent.Property(x => x.ExternalSubscriptionId).HasMaxLength(64);
        billingEvent.Property(x => x.OccurredAtUtc);
        billingEvent.Property(x => x.Outcome).HasMaxLength(24).IsRequired();
        billingEvent.Property(x => x.ProcessedAtUtc);
        billingEvent.HasIndex(x => new { x.AccountId, x.ProcessedAtUtc });
        billingEvent
            .HasOne<CloudAccountResource>()
            .WithMany()
            .HasForeignKey(x => x.AccountId)
            .OnDelete(DeleteBehavior.Restrict);

        var aiUsage = modelBuilder.Entity<CloudAiUsageRecord>();
        aiUsage.ToTable("CloudAiUsage");
        aiUsage.HasKey(x => x.Id);
        aiUsage.Property(x => x.Id).ValueGeneratedOnAdd();
        aiUsage.Property(x => x.Kind).HasMaxLength(16).IsRequired();
        aiUsage.Property(x => x.Provider).HasMaxLength(32).IsRequired();
        aiUsage.Property(x => x.Model).HasMaxLength(128).IsRequired();
        aiUsage.Property(x => x.ModelVersion).HasMaxLength(128);
        aiUsage.Property(x => x.PricingEpoch).HasMaxLength(128);
        aiUsage.Property(x => x.ResultCategory).HasMaxLength(32).IsRequired();
        aiUsage.Property(x => x.ProviderFinishReason).HasMaxLength(64);
        aiUsage.HasIndex(x => new { x.AccountId, x.PeriodStartUtc });
        aiUsage.HasIndex(x => new { x.AccountId, x.Kind, x.StartedAtUtc });
        aiUsage.HasIndex(x => x.PeriodStartUtc);
        aiUsage
            .HasOne<CloudAccountResource>()
            .WithMany()
            .HasForeignKey(x => x.AccountId)
            .OnDelete(DeleteBehavior.Restrict);

        var aiReservation = modelBuilder.Entity<CloudAiUsageReservation>();
        aiReservation.ToTable("CloudAiUsageReservations");
        aiReservation.HasKey(x => x.Id);
        aiReservation.Property(x => x.Id).ValueGeneratedNever();
        aiReservation.Property(x => x.Kind).HasMaxLength(16).IsRequired();
        aiReservation.Property(x => x.Provider).HasMaxLength(32).IsRequired();
        aiReservation.Property(x => x.Model).HasMaxLength(128).IsRequired();
        aiReservation.Property(x => x.ModelVersion).HasMaxLength(128);
        aiReservation.HasIndex(x => new { x.AccountId, x.PeriodStartUtc });
        aiReservation.HasIndex(x => new { x.AccountId, x.Kind, x.StartedAtUtc });
        aiReservation.HasIndex(x => x.PeriodStartUtc);
        aiReservation
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

        _ = await db.BillingBindings
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);

        _ = await db.BillingEvents
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);

        _ = await db.AiUsage
            .AsNoTracking()
            .Take(1)
            .ToListAsync(cancellationToken);

        _ = await db.AiUsageReservations
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

            CREATE TABLE IF NOT EXISTS "CloudBillingBindings" (
                "AccountId" uuid NOT NULL,
                "Provider" character varying(32) NOT NULL,
                "ExternalTransactionId" character varying(64) NULL,
                "ExternalCustomerId" character varying(64) NULL,
                "ExternalSubscriptionId" character varying(64) NULL,
                "LastEventOccurredAtUtc" timestamp with time zone NULL,
                "UpdatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_CloudBillingBindings" PRIMARY KEY ("AccountId"),
                CONSTRAINT "FK_CloudBillingBindings_AccountResources_AccountId"
                    FOREIGN KEY ("AccountId") REFERENCES "AccountResources" ("AccountId")
                    ON DELETE RESTRICT
            );

            CREATE UNIQUE INDEX IF NOT EXISTS "IX_CloudBillingBindings_Provider_ExternalSubscriptionId"
                ON "CloudBillingBindings" ("Provider", "ExternalSubscriptionId");

            CREATE TABLE IF NOT EXISTS "CloudBillingEvents" (
                "Provider" character varying(32) NOT NULL,
                "EventId" character varying(96) NOT NULL,
                "AccountId" uuid NOT NULL,
                "ExternalSubscriptionId" character varying(64) NULL,
                "OccurredAtUtc" timestamp with time zone NOT NULL,
                "Outcome" character varying(24) NOT NULL,
                "ProcessedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_CloudBillingEvents" PRIMARY KEY ("Provider", "EventId"),
                CONSTRAINT "FK_CloudBillingEvents_AccountResources_AccountId"
                    FOREIGN KEY ("AccountId") REFERENCES "AccountResources" ("AccountId")
                    ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS "IX_CloudBillingEvents_AccountId_ProcessedAtUtc"
                ON "CloudBillingEvents" ("AccountId", "ProcessedAtUtc");

            CREATE TABLE IF NOT EXISTS "CloudAiUsage" (
                "Id" bigint GENERATED BY DEFAULT AS IDENTITY,
                "AccountId" uuid NOT NULL,
                "Kind" character varying(16) NOT NULL,
                "Provider" character varying(32) NOT NULL,
                "Model" character varying(128) NOT NULL,
                "ModelVersion" character varying(128) NULL,
                "PricingEpoch" character varying(128) NULL,
                "StartedAtUtc" timestamp with time zone NOT NULL,
                "CompletedAtUtc" timestamp with time zone NOT NULL,
                "PeriodStartUtc" timestamp with time zone NOT NULL,
                "UpstreamRequestCount" integer NOT NULL,
                "InputTokens" integer NULL,
                "OutputTokens" integer NULL,
                "ThinkingTokens" integer NULL,
                "ReportedTotalTokens" integer NULL,
                "ToolLoopIterations" integer NOT NULL,
                "SttDurationMilliseconds" bigint NULL,
                "EstimatedCostMicrousd" bigint NULL,
                "QuotaChargeMicrousd" bigint NOT NULL,
                "ResultCategory" character varying(32) NOT NULL,
                "ProviderFinishReason" character varying(64) NULL,
                CONSTRAINT "PK_CloudAiUsage" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_CloudAiUsage_AccountResources_AccountId"
                    FOREIGN KEY ("AccountId") REFERENCES "AccountResources" ("AccountId")
                    ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS "IX_CloudAiUsage_AccountId_PeriodStartUtc"
                ON "CloudAiUsage" ("AccountId", "PeriodStartUtc");
            CREATE INDEX IF NOT EXISTS "IX_CloudAiUsage_AccountId_Kind_StartedAtUtc"
                ON "CloudAiUsage" ("AccountId", "Kind", "StartedAtUtc");
            CREATE INDEX IF NOT EXISTS "IX_CloudAiUsage_PeriodStartUtc"
                ON "CloudAiUsage" ("PeriodStartUtc");

            CREATE TABLE IF NOT EXISTS "CloudAiUsageReservations" (
                "Id" uuid NOT NULL,
                "AccountId" uuid NOT NULL,
                "Kind" character varying(16) NOT NULL,
                "Provider" character varying(32) NOT NULL,
                "Model" character varying(128) NOT NULL,
                "ModelVersion" character varying(128) NULL,
                "StartedAtUtc" timestamp with time zone NOT NULL,
                "PeriodStartUtc" timestamp with time zone NOT NULL,
                "ReservedMicrousd" bigint NOT NULL,
                CONSTRAINT "PK_CloudAiUsageReservations" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_CloudAiUsageReservations_AccountResources_AccountId"
                    FOREIGN KEY ("AccountId") REFERENCES "AccountResources" ("AccountId")
                    ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS "IX_CloudAiUsageReservations_AccountId_PeriodStartUtc"
                ON "CloudAiUsageReservations" ("AccountId", "PeriodStartUtc");
            CREATE INDEX IF NOT EXISTS "IX_CloudAiUsageReservations_AccountId_Kind_StartedAtUtc"
                ON "CloudAiUsageReservations" ("AccountId", "Kind", "StartedAtUtc");
            CREATE INDEX IF NOT EXISTS "IX_CloudAiUsageReservations_PeriodStartUtc"
                ON "CloudAiUsageReservations" ("PeriodStartUtc");

            CREATE TABLE IF NOT EXISTS "DataProtectionKeys" (
                "FriendlyName" character varying(200) NOT NULL,
                "EncryptedXml" text NOT NULL,
                "CreatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_DataProtectionKeys" PRIMARY KEY ("FriendlyName")
            );
            """,
            cancellationToken);
    }
}
