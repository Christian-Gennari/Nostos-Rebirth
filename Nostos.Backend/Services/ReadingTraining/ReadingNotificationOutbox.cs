using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

// Transactional notification outbox for reading-training events. The enqueue
// side is a pure scanner over persisted session state (server-authoritative
// elapsed time), the claim side hands unacknowledged rows to a delivery
// worker under a lease, and acknowledgement marks delivery complete. Rows are
// deduplicated by a stable DedupeKey so retries, restarts and concurrent
// scanners can never produce more than one row per logical event.
public interface IReadingNotificationOutbox
{
    // Scans open Active sessions and enqueues exactly one target-reached row
    // per session whose server-authoritative elapsed time meets its planned
    // target. Returns the number of rows newly enqueued. Never mutates the
    // session, programme or any state version.
    Task<int> EnqueueTargetReachedAsync(CancellationToken cancellationToken = default);

    // Atomically claims up to maxCount of the oldest unacknowledged rows that
    // are unleased or whose lease has expired, setting LeaseUntil = now +
    // lease. Concurrent claimers never receive the same row. Returns typed
    // payloads in claim (CreatedAt) order.
    Task<IReadOnlyList<ClaimedReadingNotification>> ClaimDueAsync(
        int maxCount, TimeSpan lease, CancellationToken cancellationToken = default);

    // Marks a notification acknowledged (clearing any lease). Idempotent:
    // true for any existing row, including already-acknowledged ones; false
    // for an unknown id. Acknowledged rows are never claimable again.
    Task<bool> AcknowledgeAsync(Guid id, CancellationToken cancellationToken = default);
}

// A row handed to a delivery worker: the typed payload plus the lease that
// was applied to it.
public sealed record ClaimedReadingNotification(
    Guid NotificationId,
    TargetReachedNotificationPayload Payload,
    DateTime LeaseUntil);

public sealed class ReadingNotificationOutbox(
    IDbContextFactory<NostosDbContext> dbFactory,
    IReadingClock clock) : IReadingNotificationOutbox
{
    public const string TargetReachedKind = "target-reached";

    // CamelCase with declaration-order property emission: deterministic for a
    // given payload and round-trippable through the stored JSON.
    private static readonly JsonSerializerOptions PayloadJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public async Task<int> EnqueueTargetReachedAsync(CancellationToken cancellationToken = default)
    {
        var now = clock.UtcNow;
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        // Only Active sessions accrue: Paused, Planned and AwaitingFeedback
        // never gain wall-clock time, so they are not scanned.
        var activeSessions = await db.ReadingSessions
            .AsNoTracking()
            .Where(s => s.Status == ReadingSessionStatus.Active)
            .ToListAsync(cancellationToken);

        var candidates = activeSessions
            .Select(s => new
            {
                Session = s,
                Key = $"target-reached:{s.Id:D}",
                Elapsed = EffectiveElapsedSeconds(s, now),
            })
            .Where(c => c.Elapsed >= (long)c.Session.PlannedTargetMinutes * 60)
            .ToList();

        if (candidates.Count == 0)
            return 0;

        // Rows already present for these keys — acknowledged or not — make
        // the event a duplicate; acked events must never re-fire.
        var keys = candidates.Select(c => c.Key).ToList();
        var existingKeys = await db.ReadingNotifications
            .AsNoTracking()
            .Where(n => keys.Contains(n.DedupeKey!))
            .Select(n => n.DedupeKey!)
            .ToListAsync(cancellationToken);

        var toInsert = candidates.Where(c => !existingKeys.Contains(c.Key)).ToList();
        if (toInsert.Count == 0)
            return 0;

        foreach (var candidate in toInsert)
        {
            var id = Guid.NewGuid();
            var payload = TargetReachedNotificationPayload.Create(
                id,
                candidate.Session.Id,
                candidate.Session.BookId,
                candidate.Session.Mode,
                candidate.Session.PlannedTargetMinutes,
                candidate.Elapsed);
            db.ReadingNotifications.Add(new ReadingNotification
            {
                Id = id,
                Kind = TargetReachedKind,
                DedupeKey = candidate.Key,
                CreatedAt = now,
                PayloadJson = JsonSerializer.Serialize(payload, PayloadJsonOptions),
            });
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return toInsert.Count;
        }
        catch (DbUpdateException)
        {
            // Only suppress the expected dedupe race. Any other persistence
            // failure remains visible instead of being mistaken for success.
            await using var verify = await dbFactory.CreateDbContextAsync(cancellationToken);
            var insertedByRacer = await verify.ReadingNotifications.AsNoTracking()
                .Where(n => keys.Contains(n.DedupeKey))
                .Select(n => n.DedupeKey)
                .ToListAsync(cancellationToken);
            if (toInsert.All(c => insertedByRacer.Contains(c.Key)))
                return 0;
            throw;
        }
    }

    public async Task<IReadOnlyList<ClaimedReadingNotification>> ClaimDueAsync(
        int maxCount, TimeSpan lease, CancellationToken cancellationToken = default)
    {
        if (maxCount <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxCount), "maxCount must be positive.");
        if (lease <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(lease), "lease must be positive.");

        var now = clock.UtcNow;
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        var candidates = await db.ReadingNotifications
            .AsNoTracking()
            .Where(n => n.Kind == TargetReachedKind
                && n.AckedAt == null
                && (n.LeaseUntil == null || n.LeaseUntil < now))
            .OrderBy(n => n.CreatedAt)
            .ThenBy(n => n.Id)
            .Take(maxCount)
            .Select(n => new { n.Id, n.PayloadJson })
            .ToListAsync(cancellationToken);

        // Payloads must be parseable before the lease is taken; a corrupt row
        // stays due instead of wedging a delivery worker.
        var claimable = new List<(Guid Id, TargetReachedNotificationPayload Payload)>();
        foreach (var candidate in candidates)
        {
            if (JsonSerializer.Deserialize<TargetReachedNotificationPayload>(
                    candidate.PayloadJson, PayloadJsonOptions) is { } payload)
                claimable.Add((candidate.Id, payload));
        }

        var leaseUntil = now.Add(lease);
        var claimed = new List<ClaimedReadingNotification>(claimable.Count);
        foreach (var (id, payload) in claimable)
        {
            // Conditional claim: the row must still be unacknowledged and its
            // lease still expired when the UPDATE executes, so concurrent
            // claimers can never take the same row.
            var affected = await db.ReadingNotifications
                .Where(n => n.Id == id
                    && n.AckedAt == null
                    && (n.LeaseUntil == null || n.LeaseUntil < now))
                .ExecuteUpdateAsync(
                    s => s.SetProperty(n => n.LeaseUntil, leaseUntil),
                    cancellationToken);
            if (affected > 0)
                claimed.Add(new ClaimedReadingNotification(id, payload, leaseUntil));
        }

        return claimed;
    }

    public async Task<bool> AcknowledgeAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var now = clock.UtcNow;
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        var acked = await db.ReadingNotifications
            .Where(n => n.Id == id && n.AckedAt == null)
            .ExecuteUpdateAsync(
                s => s.SetProperty(n => n.AckedAt, now).SetProperty(n => n.LeaseUntil, (DateTime?)null),
                cancellationToken);
        if (acked > 0)
            return true;

        // Already acknowledged (idempotent) or unknown id.
        return await db.ReadingNotifications.AnyAsync(n => n.Id == id, cancellationToken);
    }

    // Server-authoritative elapsed time: persisted accumulated seconds plus
    // wall-clock time since the last start. Wall time is clamped at zero so a
    // skewed clock can never subtract time.
    private static long EffectiveElapsedSeconds(ReadingSession session, DateTime now)
    {
        var wallSeconds = session.LastStartedAt is { } lastStarted
            ? Math.Max(0, (long)(now - lastStarted).TotalSeconds)
            : 0L;
        return session.AccumulatedSeconds + wallSeconds;
    }
}
