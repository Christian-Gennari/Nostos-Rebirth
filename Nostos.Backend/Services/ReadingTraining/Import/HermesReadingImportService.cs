using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.ReadingTraining.Import;

/// <summary>
/// Transactional cutover for the accepted Hermes reading-data import plan
/// (Task 11B1). Persistence never parses files: the planner's immutable
/// <see cref="HermesImportDryRunReport"/> is the only source of rows, and a
/// backup is created BEFORE any database mutation. Concurrent commits are
/// serialized by a process-static gate; the unique receipt fingerprint is
/// checked before the backup and again inside the transaction.
/// </summary>
public sealed partial class HermesReadingImportService : IHermesReadingImportService
{
    private static readonly SemaphoreSlim ImportGate = new(1, 1);
    private static readonly JsonSerializerOptions ReceiptJson = new(JsonSerializerDefaults.Web);

    // Fixed deterministic fallback when a legacy row carries no parseable
    // source timestamp. Never wall clock: reruns stay byte-identical.
    private static readonly DateTime DeterministicEpoch = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private readonly IDbContextFactory<NostosDbContext> _contexts;
    private readonly IBackupService _backups;
    private readonly IReadingClock _clock;
    private readonly HermesReadingImportPlanner _planner = new();

    public HermesReadingImportService(
        IDbContextFactory<NostosDbContext> contexts,
        IBackupService backups,
        IReadingClock clock)
    {
        _contexts = contexts;
        _backups = backups;
        _clock = clock;
    }

    public async Task<HermesImportCommitResult> PlanAsync(
        string sourceDirectory,
        IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
        CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var candidates = await db.Books.AsNoTracking()
            .Select(b => new LibraryBookCandidate(b.Id, b.Title, b.Author ?? string.Empty))
            .ToListAsync(ct);
        var report = _planner.Plan(sourceDirectory, candidates, explicitBookMappings);
        return new HermesImportCommitResult(
            HermesImportCommitStatus.DryRun, report, null, null, null, null);
    }

    public async Task<HermesImportCommitResult> PlanAndCommitAsync(
        string sourceDirectory,
        IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
        CancellationToken ct = default)
    {
        var planned = await PlanAsync(sourceDirectory, explicitBookMappings, ct);
        if (planned.Status != HermesImportCommitStatus.DryRun)
            return planned;
        return await CommitAsync(planned.Report!, ct);
    }

    public Task<HermesImportCommitResult> CommitAsync(
        HermesImportDryRunReport report,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(report);
        return CommitCoreAsync(report, ct);
    }

    private async Task<HermesImportCommitResult> CommitCoreAsync(
        HermesImportDryRunReport report, CancellationToken ct)
    {
        try
        {
            await ImportGate.WaitAsync(ct);
            try
            {
                return await CommitLockedAsync(report, ct);
            }
            finally
            {
                ImportGate.Release();
            }
        }
        catch (OperationCanceledException)
        {
            return Failed(report, HermesImportCommitCodes.Cancelled);
        }
        catch (Exception)
        {
            // Rollback of the active transaction is handled inside
            // CommitLockedAsync; a failure here means no rows were committed.
            return Failed(report, HermesImportCommitCodes.CommitFailed);
        }
    }

    private async Task<HermesImportCommitResult> CommitLockedAsync(
        HermesImportDryRunReport report, CancellationToken ct)
    {
        // --- fail-closed validation: no backup, no writes ------------------
        if (report.Blocked)
            return Failed(report, HermesImportCommitCodes.Blocked);
        if (report.Programme is null)
            return Failed(report, HermesImportCommitCodes.BlockedNoProgramme);
        if (!FingerprintRegex().IsMatch(report.AggregateFingerprint))
            return Failed(report, HermesImportCommitCodes.BlockedInvalidFingerprint);
        if (report.Assignments.Any(a => a.BookId == Guid.Empty) ||
            report.Sessions.Any(s => s.BookId == Guid.Empty) ||
            report.Captures.Any(c => c.BookId == Guid.Empty))
            return Failed(report, HermesImportCommitCodes.Blocked);

        await using var db = await _contexts.CreateDbContextAsync(ct);

        // --- idempotency + clean-target pre-checks (before backup) ---------
        var prior = await db.ReadingImportReceipts.AsNoTracking()
            .SingleOrDefaultAsync(r => r.SourceFingerprint == report.AggregateFingerprint, ct);
        if (prior is not null)
            return Duplicate(report, prior);
        if (await db.ReadingImportReceipts.AnyAsync(ct) ||
            await db.ReadingBookAssignments.AnyAsync(ct) ||
            await db.ReadingSessions.AnyAsync(ct) ||
            await db.ReadingCaptures.AnyAsync(ct))
            return Failed(report, HermesImportCommitCodes.TargetNotClean);

        // An existing singleton programme is allowed only when nothing else
        // exists (verified above); it is updated in place, atomically.
        var existingProgramme = await db.ReadingProgrammes.SingleOrDefaultAsync(ct);

        // --- backup BEFORE any database mutation ---------------------------
        TriggerBackupResultDto backup;
        try
        {
            backup = await _backups.CreateBackupAsync(ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return Failed(report, HermesImportCommitCodes.BackupFailed);
        }

        var archivePath = _backups.GetLocalArchivePath(backup.Id);
        if (backup.Status != BackupStatus.Completed || backup.Id == Guid.Empty ||
            string.IsNullOrEmpty(archivePath) ||
            !archivePath.EndsWith(".nostos", StringComparison.OrdinalIgnoreCase))
        {
            return Failed(report, HermesImportCommitCodes.BackupFailed);
        }

        // --- one EF transaction --------------------------------------------
        var now = NowUtc;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            // Re-check the fingerprint inside the transaction; the unique
            // index is the final guard against cross-process races.
            var raced = await db.ReadingImportReceipts.AsNoTracking()
                .SingleOrDefaultAsync(r => r.SourceFingerprint == report.AggregateFingerprint, ct);
            if (raced is not null)
            {
                await RollbackAsync(transaction);
                return Duplicate(report, raced);
            }

            var programme = existingProgramme ?? new ReadingProgramme
            {
                Id = report.Programme.Id,
                SingletonSlot = ReadingProgramme.SingletonSentinel,
                CreatedAt = ProgrammeCreatedAt(report),
            };
            ApplyProgramme(programme, report.Programme, now);
            if (existingProgramme is null)
                db.ReadingProgrammes.Add(programme);

            foreach (var assignment in report.Assignments)
                db.ReadingBookAssignments.Add(ToAssignment(assignment));
            foreach (var session in report.Sessions)
                db.ReadingSessions.Add(ToSession(session));
            foreach (var capture in report.Captures)
                db.ReadingCaptures.Add(ToCapture(capture));

            var receipt = new ReadingImportReceipt
            {
                Id = Guid.NewGuid(),
                SourceFingerprint = report.AggregateFingerprint,
                ResultJson = SerializePayload(report, backup.Id, now),
                CreatedAt = now,
            };
            db.ReadingImportReceipts.Add(receipt);

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            return new HermesImportCommitResult(
                HermesImportCommitStatus.Committed, report, receipt.Id, backup.Id,
                receipt.ResultJson, null);
        }
        catch (Exception ex)
        {
            await RollbackAsync(transaction);
            if (ex is DbUpdateException)
            {
                // Receipt-uniqueness race with another process: converge on
                // the stored immutable receipt instead of leaking a 500.
                await using var retryDb = await _contexts.CreateDbContextAsync(ct);
                var racedReceipt = await retryDb.ReadingImportReceipts.AsNoTracking()
                    .SingleOrDefaultAsync(r => r.SourceFingerprint == report.AggregateFingerprint, CancellationToken.None);
                if (racedReceipt is not null)
                    return Duplicate(report, racedReceipt);
            }
            throw;
        }
    }

    // --- mapping helpers ---------------------------------------------------

    private static void ApplyProgramme(ReadingProgramme programme, HermesPlannedProgramme planned, DateTime updatedAt)
    {
        programme.TimezoneId = planned.TimezoneId;
        programme.StateVersion = "1";
        programme.EnduranceTargetMinutes = planned.EnduranceTargetMinutes;
        programme.DeepTargetMinutes = planned.DeepTargetMinutes;
        programme.RecoveryTargetMinutes = planned.RecoveryTargetMinutes;
        programme.EnduranceEstablishedMinutes = planned.EnduranceEstablishedMinutes;
        programme.DeepEstablishedMinutes = planned.DeepEstablishedMinutes;
        programme.RecoveryEstablishedMinutes = planned.RecoveryEstablishedMinutes;
        programme.EnduranceConsecutiveIncreases = planned.EnduranceConsecutiveIncreases;
        programme.DeepConsecutiveIncreases = planned.DeepConsecutiveIncreases;
        programme.DeloadActive = planned.EnduranceDeloaded || planned.DeepDeloaded;
        programme.DeloadStartedAt = programme.DeloadActive ? programme.CreatedAt : null;
        programme.UpdatedAt = updatedAt;
    }

    private static ReadingBookAssignment ToAssignment(HermesPlannedAssignment planned)
    {
        var created = planned.StartedAt?.UtcDateTime
            ?? planned.CompletedAt?.UtcDateTime
            ?? DeterministicEpoch;
        return new ReadingBookAssignment
        {
            Id = planned.Id,
            BookId = planned.BookId,
            Mode = planned.Mode,
            Status = planned.Status,
            QueueOrder = planned.QueueOrder,
            DefaultSlot = planned.IsDefault ? ReadingBookAssignment.DefaultSentinelFor(planned.Mode) : null,
            CreatedAt = created,
            StartedAt = planned.StartedAt?.UtcDateTime,
            CompletedAt = planned.CompletedAt?.UtcDateTime,
        };
    }

    private static ReadingSession ToSession(HermesPlannedSession planned)
    {
        // PlannedAt fallback is fully deterministic (never wall clock):
        // the plan's date-midnight PlannedAt, else StartedAt ?? CompletedAt
        // ?? UTC midnight of the parsed source date.
        var plannedAt = planned.PlannedAt?.UtcDateTime
            ?? planned.StartedAt?.UtcDateTime
            ?? planned.CompletedAt?.UtcDateTime
            ?? UtcMidnight(planned.DateRaw);
        var created = planned.StartedAt?.UtcDateTime
            ?? planned.CompletedAt?.UtcDateTime
            ?? plannedAt;
        return new ReadingSession
        {
            Id = planned.Id,
            BookAssignmentId = planned.BookAssignmentId,
            BookId = planned.BookId,
            Mode = planned.Mode,
            Status = planned.Status,
            OpenSlot = null, // dry-run blockers guarantee every imported session is closed
            TargetMinutes = planned.TargetMinutes,
            PlannedTargetMinutes = planned.PlannedTargetMinutes,
            Constraint = planned.Constraint,
            PlannedAt = plannedAt,
            StartedAt = planned.StartedAt?.UtcDateTime,
            LastStartedAt = null,
            PausedAt = null,
            CompletedAt = planned.CompletedAt?.UtcDateTime,
            RatingRequestedAt = null,
            AccumulatedSeconds = planned.AccumulatedSeconds,
            MeasuredSeconds = planned.ClockMinutes * 60,
            ReportedMinutes = planned.ReportedMinutes,
            Effort = planned.Effort ?? 0,
            Focus = planned.Focus ?? 0,
            Rating = null,
            RatingsSkipped = planned.RatingsSkipped,
            NoticeSent = false,
            CreatedAt = created,
            UpdatedAt = created,
        };
    }

    private static ReadingCapture ToCapture(HermesPlannedCapture planned)
    {
        var created = planned.CapturedAt?.UtcDateTime
            ?? UtcMidnight(planned.DateRaw);
        return new ReadingCapture
        {
            Id = planned.Id,
            Text = planned.Text,
            Type = planned.Type,
            BookId = planned.BookId,
            SessionId = planned.PlannedSessionId,
            ExternalId = planned.SourceCaptureId,
            Resolved = planned.Resolved,
            PromotedNoteId = null,
            CreatedAt = created,
        };
    }

    private static DateTime ProgrammeCreatedAt(HermesImportDryRunReport report)
    {
        var planned = report.Programme!;
        if (planned.InitializedAt is { } initialized)
            return initialized.UtcDateTime;
        // Fixed deterministic fallback: the earliest source timestamp in the
        // plan (never wall clock).
        return report.Assignments
            .SelectMany(a => new DateTimeOffset?[] { a.StartedAt, a.CompletedAt })
            .Concat(report.Sessions.SelectMany(s => new DateTimeOffset?[] { s.StartedAt, s.CompletedAt, s.PlannedAt }))
            .Concat(report.Captures.Select(c => c.CapturedAt))
            .Where(x => x.HasValue)
            .Select(x => x!.Value.UtcDateTime)
            .DefaultIfEmpty(DeterministicEpoch)
            .Min();
    }

    private static DateTime UtcMidnight(string? dateRaw)
    {
        if (dateRaw is not null &&
            DateTime.TryParse(dateRaw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal, out var date))
        {
            return DateTime.SpecifyKind(date.Date, DateTimeKind.Utc);
        }
        return DeterministicEpoch;
    }

    // --- receipt payload ---------------------------------------------------

    private string SerializePayload(HermesImportDryRunReport report, Guid backupId, DateTime committedAtUtc) =>
        JsonSerializer.Serialize(new HermesImportReceiptPayload(
            Version: "1",
            report.AggregateFingerprint,
            backupId,
            report.Files,
            report.SourceCounts,
            report.PlannedCounts,
            new HermesCommittedCounts(report.Assignments.Count, report.Sessions.Count, report.Captures.Count),
            report.BookMappings,
            report.Skips,
            report.Warnings,
            committedAtUtc), ReceiptJson);

    private static HermesImportCommitResult Duplicate(
        HermesImportDryRunReport report, ReadingImportReceipt stored)
    {
        Guid? backupId = null;
        try
        {
            var payload = JsonSerializer.Deserialize<HermesImportReceiptPayload>(stored.ResultJson, ReceiptJson);
            backupId = payload?.BackupId;
        }
        catch (JsonException)
        {
            // Stored receipt payload is corrupt; still return the stored
            // immutable JSON so the caller can inspect it.
        }
        return new HermesImportCommitResult(
            HermesImportCommitStatus.Duplicate, report, stored.Id, backupId,
            stored.ResultJson, null);
    }

    private static HermesImportCommitResult Failed(HermesImportDryRunReport report, string code) =>
        new(HermesImportCommitStatus.Failed, report, null, null, null, code);

    private static async Task RollbackAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction)
    {
        try
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }
        catch (InvalidOperationException)
        {
            // Already committed/rolled back; nothing left to do.
        }
    }

    private DateTime NowUtc => DateTime.SpecifyKind(_clock.UtcNow, DateTimeKind.Utc);

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex FingerprintRegex();
}
