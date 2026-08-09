using Nostos.Backend.Configuration;
using Nostos.Backend.Services.ReadingTraining;

namespace Nostos.Backend.Workers;

// Calm-pace notification scanner for the reading-training outbox. Each cycle
// resolves the scoped outbox and enqueues target-reached rows for any Active
// session whose server-authoritative elapsed time has met its planned target;
// the outbox owns dedupe, leasing and acknowledgement. The worker enqueues
// only — it never claims, acknowledges or delivers notifications, and it
// never mutates sessions, programmes or state versions.
public sealed class ReadingNotificationWorker(
    IServiceScopeFactory scopeFactory,
    ReadingTrainingOptions options,
    ILogger<ReadingNotificationWorker> logger) : BackgroundService
{
    // The poll interval is clamped to a calm 1..300s window regardless of
    // configuration, so a misconfigured value can never turn the scanner
    // into a hot loop.
    public const int MinPollSeconds = 1;
    public const int MaxPollSeconds = 300;

    /// <summary>
    /// Runs one scoped scan cycle: resolve <see cref="IReadingNotificationOutbox"/>
    /// from a fresh scope and call <see cref="IReadingNotificationOutbox.EnqueueTargetReachedAsync"/>.
    /// Exposed so tests and one-shot triggers can drive a single scan
    /// deterministically without starting the background loop.
    /// </summary>
    public async Task ScanOnceAsync(CancellationToken cancellationToken = default)
    {
        using var scope = scopeFactory.CreateScope();
        var outbox = scope.ServiceProvider.GetRequiredService<IReadingNotificationOutbox>();

        var enqueued = await outbox.EnqueueTargetReachedAsync(cancellationToken);
        if (enqueued > 0)
        {
            logger.LogInformation(
                "Reading notification scanner enqueued {Count} target-reached notification(s).",
                enqueued);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Reading notification worker started; scanning immediately.");

        var pollSeconds = Math.Clamp(options.NotificationPollSeconds, MinPollSeconds, MaxPollSeconds);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(pollSeconds));

        try
        {
            // Scan immediately on startup, then every poll interval. A failed
            // cycle is logged and swallowed so the loop continues on the next
            // tick; only the timer itself can end the loop.
            do
            {
                try
                {
                    await ScanOnceAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Reading notification scan cycle failed; continuing.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            logger.LogInformation(
                "Reading notification worker received stop signal and is shutting down.");
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex, "Reading notification worker crashed fatally.");
        }
    }
}
