using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Ai;

namespace Nostos.Backend.Cloud.Ai;

/// <summary>
/// PostgreSQL-backed admission + accounting for Nostos-funded managed AI.
/// Admission takes a short global/account advisory lock transaction, checks the
/// rate/month/global layers, then persists a reservation before provider spend.
/// Settlement replaces that reservation with a content-free usage record.
/// </summary>
public sealed class CloudManagedAiUsageService(
    IDbContextFactory<CloudControlPlaneDbContext> factory,
    ICloudTenantContextAccessor tenantContext,
    ICloudEntitlementService entitlements,
    CloudManagedAiOptions managedAi,
    CloudManagedAiUsageOptions options,
    TimeProvider timeProvider,
    ILogger<CloudManagedAiUsageService> logger) : IManagedAiUsageService
{
    private const long GlobalAdvisoryLock = -405_000_000_000_001L;
    private const long LlmReservationMicrousd = 50_000; // #406's $0.05 per-turn ceiling.

    public Task<ManagedAiUsageLease?> BeginLlmTurnAsync(CancellationToken cancellationToken = default) =>
        BeginAsync(
            ManagedAiUsageKind.Llm,
            "google",
            managedAi.LlmModel,
            LlmReservationMicrousd,
            options.LlmRequestsPerWindow,
            cancellationToken);

    public Task<ManagedAiUsageLease?> BeginSttAsync(CancellationToken cancellationToken = default)
    {
        var estimate = CloudAiPricing.EstimateStt(
            "groq",
            managedAi.SttModel,
            UtcNow(),
            options.SttReservationSeconds);

        // Unknown future STT pricing is still bounded conservatively rather than
        // being treated as zero-cost.
        var reserve = estimate?.Microusd ?? LlmReservationMicrousd;
        return BeginAsync(
            ManagedAiUsageKind.Stt,
            "groq",
            managedAi.SttModel,
            reserve,
            options.SttRequestsPerWindow,
            cancellationToken);
    }

    public async Task CompleteLlmTurnAsync(
        ManagedAiUsageLease? lease,
        ManagedAiLlmUsage usage,
        CancellationToken cancellationToken = default)
    {
        if (lease is null)
            return;

        await SettleAsync(
            lease,
            usage.UpstreamRequestCount,
            usage.InputTokens,
            usage.OutputTokens,
            usage.ThinkingTokens,
            usage.ReportedTotalTokens,
            usage.ToolLoopIterations,
            sttDurationMilliseconds: null,
            usage.ResultCategory,
            usage.ProviderFinishReason,
            cancellationToken);
    }

    public async Task CompleteSttAsync(
        ManagedAiUsageLease? lease,
        ManagedAiSttUsage usage,
        CancellationToken cancellationToken = default)
    {
        if (lease is null)
            return;

        long? durationMs = usage.DurationSeconds is null
            ? null
            : checked((long)Math.Round(usage.DurationSeconds.Value * 1000d));

        await SettleAsync(
            lease,
            usage.UpstreamRequestCount,
            inputTokens: null,
            outputTokens: null,
            thinkingTokens: null,
            reportedTotalTokens: null,
            toolLoopIterations: 0,
            durationMs,
            usage.ResultCategory,
            providerFinishReason: null,
            cancellationToken);
    }

    public async Task<ManagedAiUsageStatus> GetStatusAsync(
        CancellationToken cancellationToken = default)
    {
        var entitlement = await entitlements.GetEntitlementsAsync(cancellationToken);
        if (!entitlement.CloudAccess || !entitlement.ManagedAiEnabled)
            return new ManagedAiUsageStatus(ManagedAiUsageStates.NotIncluded, null);

        var now = UtcNow();
        var periodStart = PeriodStart(now);
        var renews = periodStart.AddMonths(1);

        if (!options.OperatorEnabled || options.GlobalMonthlyBudgetMicrousd == 0)
            return new ManagedAiUsageStatus(ManagedAiUsageStates.TemporarilyUnavailable, renews);

        var account = tenantContext.GetRequired();
        await using var db = await factory.CreateDbContextAsync(cancellationToken);

        var committed = await db.AiUsage
            .Where(x => x.AccountId == account.AccountId.Value && x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.QuotaChargeMicrousd, cancellationToken) ?? 0;
        var reserved = await db.AiUsageReservations
            .Where(x => x.AccountId == account.AccountId.Value && x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.ReservedMicrousd, cancellationToken) ?? 0;
        var used = checked(committed + reserved);

        if (entitlement.ManagedAiMonthlyAllowance <= 0
            || used >= entitlement.ManagedAiMonthlyAllowance)
        {
            return new ManagedAiUsageStatus(ManagedAiUsageStates.Exhausted, renews);
        }

        var globalCommitted = await db.AiUsage
            .Where(x => x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.QuotaChargeMicrousd, cancellationToken) ?? 0;
        var globalReserved = await db.AiUsageReservations
            .Where(x => x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.ReservedMicrousd, cancellationToken) ?? 0;

        if (checked(globalCommitted + globalReserved) >= options.GlobalMonthlyBudgetMicrousd)
            return new ManagedAiUsageStatus(ManagedAiUsageStates.TemporarilyUnavailable, renews);

        var threshold =
            entitlement.ManagedAiMonthlyAllowance * options.NearLimitPercent / 100;
        return new ManagedAiUsageStatus(
            used >= threshold ? ManagedAiUsageStates.NearLimit : ManagedAiUsageStates.Normal,
            renews);
    }

    private async Task<ManagedAiUsageLease?> BeginAsync(
        ManagedAiUsageKind kind,
        string provider,
        string model,
        long reserveMicrousd,
        int requestLimit,
        CancellationToken cancellationToken)
    {
        var entitlement = await entitlements.GetEntitlementsAsync(cancellationToken);
        if (!entitlement.CloudAccess || !entitlement.ManagedAiEnabled)
        {
            throw new ManagedAiUsageException(
                ManagedAiUsageBlockReason.NotEntitled,
                "Managed AI is not included for this Cloud account.");
        }

        if (!options.OperatorEnabled || options.GlobalMonthlyBudgetMicrousd == 0)
        {
            throw new ManagedAiUsageException(
                ManagedAiUsageBlockReason.OperatorDisabled,
                "Managed AI is temporarily unavailable.");
        }

        if (entitlement.ManagedAiMonthlyAllowance <= 0)
        {
            throw new ManagedAiUsageException(
                ManagedAiUsageBlockReason.MonthlyAllowanceExhausted,
                "This account has reached its managed AI allowance for the current month.");
        }

        var account = tenantContext.GetRequired();
        var now = UtcNow();
        var periodStart = PeriodStart(now);
        var windowStart = now.AddSeconds(-options.RateWindowSeconds);

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction =
            await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);

        await AcquireLocksAsync(db, account.AccountId, cancellationToken);

        var completedInWindow = await db.AiUsage.CountAsync(
            x => x.AccountId == account.AccountId.Value
                 && x.Kind == Kind(kind)
                 && x.StartedAtUtc >= windowStart,
            cancellationToken);
        var reservedInWindow = await db.AiUsageReservations.CountAsync(
            x => x.AccountId == account.AccountId.Value
                 && x.Kind == Kind(kind)
                 && x.StartedAtUtc >= windowStart,
            cancellationToken);

        if (checked(completedInWindow + reservedInWindow) >= requestLimit)
        {
            throw new ManagedAiUsageException(
                ManagedAiUsageBlockReason.RateLimited,
                "Managed AI is receiving too many requests from this account. Try again shortly.");
        }

        var accountCommitted = await db.AiUsage
            .Where(x => x.AccountId == account.AccountId.Value && x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.QuotaChargeMicrousd, cancellationToken) ?? 0;
        var accountReserved = await db.AiUsageReservations
            .Where(x => x.AccountId == account.AccountId.Value && x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.ReservedMicrousd, cancellationToken) ?? 0;

        if (checked(accountCommitted + accountReserved + reserveMicrousd)
            > entitlement.ManagedAiMonthlyAllowance)
        {
            throw new ManagedAiUsageException(
                ManagedAiUsageBlockReason.MonthlyAllowanceExhausted,
                "This account has reached its managed AI allowance for the current month.");
        }

        var globalCommitted = await db.AiUsage
            .Where(x => x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.QuotaChargeMicrousd, cancellationToken) ?? 0;
        var globalReserved = await db.AiUsageReservations
            .Where(x => x.PeriodStartUtc == periodStart)
            .SumAsync(x => (long?)x.ReservedMicrousd, cancellationToken) ?? 0;

        if (checked(globalCommitted + globalReserved + reserveMicrousd)
            > options.GlobalMonthlyBudgetMicrousd)
        {
            throw new ManagedAiUsageException(
                ManagedAiUsageBlockReason.OperatorBudgetExhausted,
                "Managed AI is temporarily unavailable.");
        }

        var reservation = new CloudAiUsageReservation
        {
            Id = Guid.NewGuid(),
            AccountId = account.AccountId.Value,
            Kind = Kind(kind),
            Provider = provider,
            Model = model,
            ModelVersion = null,
            StartedAtUtc = now,
            PeriodStartUtc = periodStart,
            ReservedMicrousd = reserveMicrousd,
        };
        db.AiUsageReservations.Add(reservation);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new ManagedAiUsageLease(reservation.Id, kind);
    }

    private async Task SettleAsync(
        ManagedAiUsageLease lease,
        int upstreamRequestCount,
        int? inputTokens,
        int? outputTokens,
        int? thinkingTokens,
        int? reportedTotalTokens,
        int toolLoopIterations,
        long? sttDurationMilliseconds,
        string resultCategory,
        string? providerFinishReason,
        CancellationToken cancellationToken)
    {
        var account = tenantContext.GetRequired();
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction =
            await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);

        await AcquireLocksAsync(db, account.AccountId, cancellationToken);

        var reservation = await db.AiUsageReservations.SingleOrDefaultAsync(
            x => x.Id == lease.ReservationId && x.AccountId == account.AccountId.Value,
            cancellationToken);
        if (reservation is null)
        {
            // Duplicate settlement is harmless; importantly, a lease cannot be
            // used to mutate another account's counters.
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        CloudAiCostEstimate? estimate = lease.Kind switch
        {
            ManagedAiUsageKind.Llm => CloudAiPricing.EstimateLlm(
                reservation.Provider,
                reservation.Model,
                reservation.StartedAtUtc,
                inputTokens,
                outputTokens),
            ManagedAiUsageKind.Stt => CloudAiPricing.EstimateStt(
                reservation.Provider,
                reservation.Model,
                reservation.StartedAtUtc,
                sttDurationMilliseconds is null
                    ? null
                    : sttDurationMilliseconds.Value / 1000d),
            _ => null,
        };

        // A provider-reported known cost replaces the reservation. Unknown cost
        // remains unknown in EstimatedCostMicrousd but consumes the conservative
        // reservation so failure/partial calls are never silently declared free.
        var quotaCharge = estimate?.Microusd ?? reservation.ReservedMicrousd;

        db.AiUsage.Add(new CloudAiUsageRecord
        {
            AccountId = account.AccountId.Value,
            Kind = reservation.Kind,
            Provider = reservation.Provider,
            Model = reservation.Model,
            ModelVersion = reservation.ModelVersion,
            PricingEpoch = estimate?.PricingEpoch,
            StartedAtUtc = reservation.StartedAtUtc,
            CompletedAtUtc = UtcNow(),
            PeriodStartUtc = reservation.PeriodStartUtc,
            UpstreamRequestCount = upstreamRequestCount,
            InputTokens = inputTokens,
            OutputTokens = outputTokens,
            ThinkingTokens = thinkingTokens,
            ReportedTotalTokens = reportedTotalTokens,
            ToolLoopIterations = toolLoopIterations,
            SttDurationMilliseconds = sttDurationMilliseconds,
            EstimatedCostMicrousd = estimate?.Microusd,
            QuotaChargeMicrousd = quotaCharge,
            ResultCategory = Limit(resultCategory, 32),
            ProviderFinishReason = providerFinishReason is null
                ? null
                : Limit(providerFinishReason, 64),
        });
        db.AiUsageReservations.Remove(reservation);

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        if (estimate is null)
        {
            logger.LogWarning(
                "Managed AI usage cost is unknown for {Provider}/{Model}; charged conservative reservation {ReservedMicrousd} micro-USD.",
                reservation.Provider,
                reservation.Model,
                reservation.ReservedMicrousd);
        }
    }

    private static async Task AcquireLocksAsync(
        CloudControlPlaneDbContext db,
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        // Fixed order prevents deadlocks. The global lock protects the aggregate
        // operator ceiling; the account lock protects monthly/rate admission.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({GlobalAdvisoryLock});",
            cancellationToken);

        var bytes = accountId.Value.ToByteArray();
        var accountLock = BitConverter.ToInt64(bytes, 0) ^ 0x405_405_405_405;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({accountLock});",
            cancellationToken);
    }

    private DateTime UtcNow() => timeProvider.GetUtcNow().UtcDateTime;

    private static DateTime PeriodStart(DateTime utc) =>
        new(utc.Year, utc.Month, 1, 0, 0, 0, DateTimeKind.Utc);

    private static string Kind(ManagedAiUsageKind kind) =>
        kind == ManagedAiUsageKind.Llm ? "llm" : "stt";

    private static string Limit(string value, int max) =>
        value.Length <= max ? value : value[..max];
}
