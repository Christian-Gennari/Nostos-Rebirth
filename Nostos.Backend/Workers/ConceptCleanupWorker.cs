using Nostos.Backend.Data.Interfaces;

namespace Nostos.Backend.Workers;

public class ConceptCleanupWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<ConceptCleanupWorker> logger
) : BackgroundService
{
    // Run every 1 hour
    private readonly PeriodicTimer _timer = new(TimeSpan.FromHours(1));

    /// <summary>
    /// Runs the Concept Cleanup Worker loop until the app is stopped.
    /// </summary>
    /// <remarks>
    /// This method is called by the ASP.NET Core framework as part of the BackgroundService.
    /// It will run every hour until the app is stopped.
    /// If an exception occurs in the loop, it will be caught and logged, but the loop will continue.
    /// If the timer itself crashes, it will be logged as critical.
    /// </remarks>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Concept Cleanup Worker started.");

        try
        {
            // Loop until the app stops
            while (await _timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await DoWorkAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    // 🔴 CRITICAL: Log the error, but swallow the exception
                    // so the loop continues next tick.
                    logger.LogError(ex, "An error occurred during the Concept Cleanup cycle.");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Log graceful shutdown so you see it in the logs
            logger.LogInformation(
                "Concept Cleanup Worker received stop signal and is shutting down."
            );
        }
        catch (Exception ex)
        {
            // 🔴 Failsafe: If the timer itself crashes (rare), log it as critical.
            logger.LogCritical(ex, "Concept Cleanup Worker crashed fatally and will not restart.");
        }
    }

    /// <summary>
    /// Periodically cleans up orphaned concepts (concepts with no links to notes).
    /// </summary>
    private async Task DoWorkAsync(CancellationToken stoppingToken)
    {
        using var scope = scopeFactory.CreateScope();
        var conceptRepo = scope.ServiceProvider.GetRequiredService<IConceptRepository>();

        logger.LogInformation("Scanning for orphaned concepts...");

        // Efficient Bulk Delete for concepts with no links
        var deletedCount = await conceptRepo.DeleteOrphanedAsync(stoppingToken);

        if (deletedCount > 0)
        {
            logger.LogInformation("Cleaned up {Count} orphaned concepts.", deletedCount);
        }
    }
}
