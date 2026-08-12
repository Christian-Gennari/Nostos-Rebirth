using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Workers;

// Task 8A — weekly-review catch-up worker. The programme's weekly review is
// owned by this Nostos background service, not by any client timer: a
// completed ISO week becomes eligible at 07:00 local time (programme
// timezone) on the Monday that starts the following week, and the worker
// catches up every eligible uncommitted week so prolonged downtime never
// loses a review. Commits go exclusively through
// IReadingTrainingService.CommitWeeklyReviewAsync with a deterministic
// client id and an idempotency key derived from the ISO week key, so
// restarts and duplicate workers converge through the existing receipt and
// unique-week protections. The worker never mutates sessions, targets or the
// programme directly; its DB reads only discover the programme, its creation
// instant and already-committed week keys. An uninitialized programme is a
// silent no-op.
public sealed class ReadingWeeklyReviewWorker(
    IServiceScopeFactory scopeFactory,
    IDbContextFactory<NostosDbContext> contexts,
    IReadingClock clock,
    ReadingTrainingOptions options,
    ILogger<ReadingWeeklyReviewWorker> logger) : BackgroundService
{
    // Deterministic command identity so restarts and duplicate workers always
    // converge on the same stored receipts instead of re-committing.
    public const string WorkerClientId = "reading-weekly-review-worker";

    // The poll interval is clamped to a calm 1..3600s window regardless of
    // configuration, so a misconfigured value can never turn the worker into
    // a hot loop.
    public const int MinPollSeconds = 1;
    public const int MaxPollSeconds = 3600;

    // Per-scan catch-up cap: a backlog larger than this is drained across
    // consecutive scans (the loop re-scans immediately while the cap is hit),
    // so a misconfigured value only delays catch-up, never double-commits.
    public const int DefaultMaxCatchUpWeeks = 4;

    private readonly TimeZoneInfo _timezone = ResolveTimezone(options.TimezoneId);

    /// <summary>
    /// Runs one catch-up scan: discovers the programme and already-committed
    /// week keys, then commits every eligible uncommitted completed ISO week
    /// (chronological, capped at the configured maximum) through
    /// <see cref="IReadingTrainingService.CommitWeeklyReviewAsync"/>.
    /// Returns the number of weeks committed (duplicate convergence counts as
    /// progress; domain errors and per-commit exceptions are logged and
    /// skipped so the scan survives). Exposed so tests and one-shot triggers
    /// can drive a single scan deterministically without the background loop.
    /// </summary>
    public async Task<int> ScanOnceAsync(CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, _timezone);
        var currentMonday = ISOWeek.ToDateTime(
            ISOWeek.GetYear(localNow), ISOWeek.GetWeekOfYear(localNow), DayOfWeek.Monday);

        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        var programme = await db.ReadingProgrammes.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (programme is null)
        {
            // Uninitialized programme: silent no-op, never a failure.
            return 0;
        }
        var committedKeys = (await db.ReadingWeeklyReviews.AsNoTracking()
            .Select(r => r.WeekKey).ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        // The earliest possible review is the ISO week containing programme
        // creation; pre-programme weeks are never fabricated.
        var programmeLocal = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.SpecifyKind(programme.CreatedAt, DateTimeKind.Utc), _timezone);
        var programmeMonday = ISOWeek.ToDateTime(
            ISOWeek.GetYear(programmeLocal), ISOWeek.GetWeekOfYear(programmeLocal), DayOfWeek.Monday);

        // Every completed week from the programme week up to the immediately
        // previous week, in chronological order. A week is eligible once 07:00
        // local has passed on the Monday that starts the following week, so
        // the immediately previous week is never committed before that Monday
        // 07:00 boundary. Local-date arithmetic plus one timezone conversion
        // per boundary keeps DST and year transitions exact.
        var candidates = new List<(int Year, int Week)>();
        for (var monday = programmeMonday; monday < currentMonday; monday = monday.AddDays(7))
        {
            var year = ISOWeek.GetYear(monday);
            var week = ISOWeek.GetWeekOfYear(monday);
            var weekKey = $"{year}-W{week:00}";
            if (committedKeys.Contains(weekKey)) continue;
            var eligibleUtc = ToUtc(monday.AddDays(7).AddHours(7));
            if (nowUtc < eligibleUtc) continue;
            candidates.Add((year, week));
        }

        var maxCatchUp = Math.Max(1, options.WeeklyReviewMaxCatchUpWeeks);
        var committed = 0;
        using var scope = scopeFactory.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<IReadingTrainingService>();
        foreach (var (year, week) in candidates.Take(maxCatchUp))
        {
            var weekKey = $"{year}-W{week:00}";
            try
            {
                var result = await service.CommitWeeklyReviewAsync(new ReadingCommitWeeklyReviewRequest(
                    WorkerClientId, $"weekly-review:{weekKey}", year, week), cancellationToken);
                if (result.Data is ReadingErrorDto error)
                {
                    if (error.Code == "not_initialized")
                    {
                        logger.LogDebug("Weekly-review catch-up skipped {WeekKey}: programme not initialized.", weekKey);
                        continue;
                    }
                    logger.LogWarning(
                        "Weekly-review catch-up rejected {WeekKey} (domain error {Code}); it stays uncommitted and will be retried on a later scan.",
                        weekKey, error.Code);
                    continue;
                }
                committed++;
                if (result.Duplicate)
                {
                    logger.LogDebug("Weekly-review catch-up converged on already-committed {WeekKey}.", weekKey);
                }
                else
                {
                    logger.LogInformation("Weekly-review catch-up committed {WeekKey}.", weekKey);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Weekly-review catch-up commit for {WeekKey} failed; continuing with the remaining weeks.", weekKey);
            }
        }
        return committed;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Reading weekly-review worker started; scanning immediately for eligible weeks.");

        var pollSeconds = Math.Clamp(options.WeeklyReviewPollSeconds, MinPollSeconds, MaxPollSeconds);
        var maxCatchUp = Math.Max(1, options.WeeklyReviewMaxCatchUpWeeks);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(pollSeconds));

        try
        {
            // Scan immediately on startup, then every poll interval. A scan
            // that hit the per-scan catch-up cap leaves a likely backlog, so
            // it is retried immediately instead of waiting a full interval;
            // every commit is idempotent, so the loop always makes progress
            // and settles once the backlog is drained. A failed cycle is
            // logged and swallowed so the loop continues on the next tick;
            // only the timer or the stop signal can end the loop.
            while (true)
            {
                int committed;
                try
                {
                    committed = await ScanOnceAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Reading weekly-review scan cycle failed; continuing.");
                    committed = 0;
                }

                if (committed >= maxCatchUp) continue;

                try
                {
                    await timer.WaitForNextTickAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            logger.LogInformation("Reading weekly-review worker received stop signal and is shutting down.");
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex, "Reading weekly-review worker crashed fatally.");
        }
    }

    // The 07:00 local Monday boundary converted to a UTC instant under the
    // configured programme timezone; DST shifts are resolved by the timezone
    // rules for that specific date.
    private DateTime ToUtc(DateTime local) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), _timezone);

    private static TimeZoneInfo ResolveTimezone(string id)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Stockholm");
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Stockholm");
        }
    }
}
