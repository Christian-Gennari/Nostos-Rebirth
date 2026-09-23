using Nostos.Backend.Configuration;

namespace Nostos.Backend.Cloud.Recovery;

/// <summary>
/// Background service that executes the Cloud operational backup sweep on a
/// nightly schedule.
///
/// The schedule defaults to 00:30 UTC and can be disabled via configuration.
/// This worker does not sweep immediately at startup — it waits until the first
/// scheduled occurrence.
/// </summary>
public sealed class CloudScheduledBackupWorker(
    CloudRecoveryScheduleOptions options,
    CloudBackupSweepRunner runner,
    ILogger<CloudScheduledBackupWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            logger.LogInformation(
                "Cloud scheduled backups are disabled. No automatic sweeps will run.");
            return;
        }

        logger.LogInformation(
            "Cloud scheduled backup worker started. Schedule: {Hour:D2}:{Minute:D2} UTC daily.",
            options.HourUtc,
            options.MinuteUtc);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                var next = options.NextOccurrence(now);

                if (!next.HasValue)
                {
                    // Disabled during runtime; exit cleanly.
                    logger.LogInformation(
                        "Cloud scheduled backups are now disabled. Worker exiting.");
                    break;
                }

                var delay = next.Value - now;

                logger.LogInformation(
                    "Next Cloud backup sweep scheduled at {NextOccurrence:yyyy-MM-dd HH:mm:ss} UTC (in {Delay:hh\\:mm\\:ss}).",
                    next.Value,
                    delay);

                await Task.Delay(delay, stoppingToken);

                await runner.RunAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Clean shutdown; do not log as an error.
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Unexpected error in Cloud scheduled backup worker: {ErrorMessage}",
                    exception.Message);

                // Continue the loop; do not let one failure kill the worker.
            }
        }

        logger.LogInformation("Cloud scheduled backup worker stopped.");
    }
}
