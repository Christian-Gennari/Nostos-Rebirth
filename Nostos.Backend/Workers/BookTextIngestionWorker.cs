using Nostos.Product.BookText;

namespace Nostos.Backend.Workers;

public sealed class BookTextIngestionWorker(
    IServiceScopeFactory scopes,
    BookTextOptions options,
    ILogger<BookTextIngestionWorker> logger) : BackgroundService
{
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(3);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Book-text ingestion worker started.");

        try
        {
            using var initialScope = scopes.CreateScope();
            await initialScope.ServiceProvider
                .GetRequiredService<BookTextBackfillService>()
                .ScheduleMissingAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                "Book-text startup backfill failed with {ExceptionType}; the worker will continue processing already queued books.",
                exception.GetType().Name);
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var didWork = await ProcessOneAsync(stoppingToken);
                if (!didWork)
                    await Task.Delay(IdleDelay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    "Book-text worker cycle failed with {ExceptionType}; publication text is not logged.",
                    exception.GetType().Name);
                await Task.Delay(IdleDelay, stoppingToken);
            }
        }
    }

    public async Task<bool> ProcessOneAsync(CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        var index = scope.ServiceProvider.GetRequiredService<IBookTextIndex>();
        var work = await index.TryClaimNextAsync(
            TimeSpan.FromMinutes(Math.Max(1, options.StaleProcessingMinutes)),
            ct);
        if (work is null) return false;

        var engine = scope.ServiceProvider.GetRequiredService<BookTextIngestionEngine>();
        await engine.ProcessAsync(work, ct);
        return true;
    }
}
