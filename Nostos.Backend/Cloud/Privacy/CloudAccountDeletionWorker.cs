using Nostos.Backend.Cloud.Runtime;

namespace Nostos.Backend.Cloud.Privacy;

public sealed record CloudAccountDeletionSweepResult(
    int Attempted,
    int Deleted,
    int Failed,
    int Busy);

public sealed class CloudAccountDeletionSweepRunner(
    ICloudAccountDeletionService deletion,
    ILogger<CloudAccountDeletionSweepRunner> logger)
{
    public async Task<CloudAccountDeletionSweepResult> RunAsync(
        CancellationToken cancellationToken = default)
    {
        var due = await deletion.ListDueAsync(cancellationToken);
        var deleted = 0;
        var failed = 0;
        var busy = 0;

        foreach (var accountId in due)
        {
            var result = await deletion.TryFinalizeAsync(accountId, cancellationToken);
            if (result is null)
            {
                busy++;
                continue;
            }

            if (result.State == CloudAccountDeletionState.Deleted)
                deleted++;
            else if (result.State == CloudAccountDeletionState.Failed)
                failed++;
        }

        logger.LogInformation(
            "Cloud deletion sweep completed. Attempted {Attempted}, deleted {Deleted}, failed {Failed}, busy {Busy}.",
            due.Count,
            deleted,
            failed,
            busy);

        return new CloudAccountDeletionSweepResult(
            due.Count,
            deleted,
            failed,
            busy);
    }
}

public sealed class CloudAccountDeletionWorker(
    ICloudWorkerLeaseManager leases,
    CloudAccountDeletionSweepRunner runner,
    ILogger<CloudAccountDeletionWorker> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Run once at startup so a restarted instance does not add a full timer
        // interval to an already-expired grace period.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var lease = await leases.TryAcquireAsync(
                    CloudWorkerLeaseNames.AccountDeletionSweep,
                    stoppingToken);

                if (lease is not null)
                    await runner.RunAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    "Cloud account deletion worker failed with {ExceptionType}; details suppressed.",
                    exception.GetType().Name);
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
