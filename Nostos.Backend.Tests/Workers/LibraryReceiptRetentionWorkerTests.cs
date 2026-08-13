using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Workers;
using Xunit;

namespace Nostos.Backend.Tests.Workers;

// Hosted-worker tests for the library receipt retention loop (issue #51).
// The worker is driven through a real DI scope factory over a temporary-file
// SQLite database; the scan interval is shortened in a test subclass so the
// full loop (immediate scan, retry, cancellation) is exercised
// deterministically.
public sealed class LibraryReceiptRetentionWorkerTests : IDisposable
{
    private readonly List<string> _databasePaths = new();

    [Fact]
    public async Task Worker_scans_immediately_on_startup_and_respects_cancellation()
    {
        var path = NewDatabasePath();
        await using (var db = CreateContext(path))
        {
            await SeedReceiptAsync(db, "expired", DateTime.UtcNow.AddDays(-91));
            await SeedReceiptAsync(db, "fresh", DateTime.UtcNow.AddDays(-1));
        }

        var provider = BuildProvider(path, contextFactory: null);
        var tracking = new TrackingScopeFactory(provider.GetRequiredService<IServiceScopeFactory>(), expectedScans: 1);
        var logger = new CapturingLogger<LibraryReceiptRetentionWorker>();
        var worker = new TestWorker(
            tracking,
            new LibraryReceiptRetentionOptions(),
            new FiredLifetime(),
            logger);

        using var cts = new CancellationTokenSource();
        var run = worker.RunAsync(cts.Token);

        // The first scan must run immediately (no waiting for an interval).
        await tracking.Done(0).WaitAsync(TimeSpan.FromSeconds(10));
        cts.Cancel();

        await run.WaitAsync(TimeSpan.FromSeconds(10));

        await using (var verify = CreateContext(path))
        {
            (await verify.LibraryCommandReceipts.CountAsync()).Should().Be(1, "the immediate scan pruned the expired receipt");
            (await verify.LibraryCommandReceipts.AnyAsync(r => r.IdempotencyKey == "fresh")).Should().BeTrue();
            (await verify.LibraryCommandReceipts.AnyAsync(r => r.IdempotencyKey == "expired")).Should().BeFalse();
        }
    }

    [Fact]
    public async Task Failed_scan_is_logged_and_retried_on_the_next_interval()
    {
        var path = NewDatabasePath();
        await using (var db = CreateContext(path))
        {
            await SeedReceiptAsync(db, "expired", DateTime.UtcNow.AddDays(-91));
        }

        // The first cleanup attempt fails inside the service (simulated by a
        // context factory that throws once); the loop must log the failure
        // and retry on the next tick, after which the prune succeeds.
        var provider = BuildProvider(path, contextFactory: new FlakyContextFactory());
        var tracking = new TrackingScopeFactory(provider.GetRequiredService<IServiceScopeFactory>(), expectedScans: 2);
        var logger = new CapturingLogger<LibraryReceiptRetentionWorker>();
        var worker = new TestWorker(
            tracking,
            new LibraryReceiptRetentionOptions(),
            new FiredLifetime(),
            logger);

        using var cts = new CancellationTokenSource();
        var run = worker.RunAsync(cts.Token);

        await tracking.Done(0).WaitAsync(TimeSpan.FromSeconds(10));
        await tracking.Done(1).WaitAsync(TimeSpan.FromSeconds(10));
        cts.Cancel();

        await run.WaitAsync(TimeSpan.FromSeconds(10));

        logger.Entries.Should().Contain(e =>
            e.Level == LogLevel.Error && e.Message.Contains("retry", StringComparison.OrdinalIgnoreCase));
        await using (var verify = CreateContext(path))
        {
            (await verify.LibraryCommandReceipts.CountAsync()).Should().Be(0, "the retried scan pruned the expired receipt");
        }
    }

    [Fact]
    public async Task Worker_cancelled_before_start_exits_gracefully()
    {
        var path = NewDatabasePath();
        var provider = BuildProvider(path, contextFactory: null);
        var worker = new TestWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new LibraryReceiptRetentionOptions(),
            new FiredLifetime(),
            new CapturingLogger<LibraryReceiptRetentionWorker>());

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var act = () => worker.RunAsync(cts.Token);

        await act.Should().NotThrowAsync();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private string NewDatabasePath()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nostos-retention-worker-{Guid.NewGuid():N}.db");
        _databasePaths.Add(path);
        return path;
    }

    private static NostosDbContext CreateContext(string path)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;
        var context = new NostosDbContext(options);
        context.Database.EnsureCreated();
        return context;
    }

    private static async Task SeedReceiptAsync(NostosDbContext db, string idempotencyKey, DateTime createdAt)
    {
        db.LibraryCommandReceipts.Add(new LibraryCommandReceipt
        {
            ClientId = "test-client",
            IdempotencyKey = idempotencyKey,
            CommandKind = "CreateOrMatchBook",
            ResponseJson = "{}",
            CreatedAt = createdAt,
        });
        await db.SaveChangesAsync();
    }

    private ServiceProvider BuildProvider(string path, IFlakyContextFactory? contextFactory)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;
        IDbContextFactory<NostosDbContext> factory = new TestContextFactory(options);
        if (contextFactory is not null)
        {
            factory = contextFactory.Wrap(factory);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(new LibraryReceiptRetentionOptions());
        services.AddSingleton(factory);
        services.AddScoped<LibraryReceiptRetentionService>();
        return services.BuildServiceProvider();
    }

    public void Dispose()
    {
        foreach (var path in _databasePaths)
        {
            foreach (var suffix in new[] { "", "-shm", "-wal" })
            {
                try
                {
                    File.Delete(path + suffix);
                }
                catch (IOException)
                {
                    // Best-effort cleanup only.
                }
            }
        }
    }

    // Drives the real loop with a short interval so immediate scan, retry and
    // cancellation are all observable in one test.
    private sealed class TestWorker(
        IServiceScopeFactory scopeFactory,
        LibraryReceiptRetentionOptions options,
        IHostApplicationLifetime lifetime,
        ILogger<LibraryReceiptRetentionWorker> logger)
        : LibraryReceiptRetentionWorker(scopeFactory, options, lifetime, logger)
    {
        protected override TimeSpan ScanInterval => TimeSpan.FromMilliseconds(50);

        public Task RunAsync(CancellationToken cancellationToken) => ExecuteAsync(cancellationToken);
    }

    // ApplicationStarted already fired, so the worker's readiness wait
    // completes immediately.
    private sealed class FiredLifetime : IHostApplicationLifetime
    {
        private readonly CancellationTokenSource _started = new();

        public FiredLifetime() => _started.Cancel();

        public CancellationToken ApplicationStarted => _started.Token;
        public CancellationToken ApplicationStopping => CancellationToken.None;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication()
        {
        }
    }

    // Signals when each worker scan has COMPLETED (the scope is disposed at
    // the end of ScanOnceAsync), so tests cancel only after the prune result
    // is durable.
    private sealed class TrackingScopeFactory(IServiceScopeFactory inner, int expectedScans) : IServiceScopeFactory
    {
        private readonly TaskCompletionSource[] _done = Enumerable.Range(0, expectedScans)
            .Select(_ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously))
            .ToArray();
        private int _count;

        public Task Done(int index) => _done[index].Task;

        public IServiceScope CreateScope()
        {
            var scope = inner.CreateScope();
            return new TrackingScope(scope, this);
        }

        private void OnScopeDisposed()
        {
            var index = Interlocked.Increment(ref _count) - 1;
            if (index < _done.Length)
            {
                _done[index].TrySetResult();
            }
        }

        private sealed class TrackingScope(IServiceScope inner, TrackingScopeFactory owner) : IServiceScope
        {
            public IServiceProvider ServiceProvider => inner.ServiceProvider;

            public void Dispose()
            {
                owner.OnScopeDisposed();
                inner.Dispose();
            }
        }
    }

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private interface IFlakyContextFactory
    {
        IDbContextFactory<NostosDbContext> Wrap(IDbContextFactory<NostosDbContext> inner);
    }

    // Fails the FIRST context creation (and therefore the first prune), then
    // delegates to the real factory.
    private sealed class FlakyContextFactory : IFlakyContextFactory
    {
        private int _calls;

        public IDbContextFactory<NostosDbContext> Wrap(IDbContextFactory<NostosDbContext> inner) =>
            new Flaky(inner, this);

        private sealed class Flaky(IDbContextFactory<NostosDbContext> inner, FlakyContextFactory owner) : IDbContextFactory<NostosDbContext>
        {
            public NostosDbContext CreateDbContext() =>
                Interlocked.Increment(ref owner._calls) == 1
                    ? throw new InvalidOperationException("simulated cleanup failure")
                    : inner.CreateDbContext();

            public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
                Interlocked.Increment(ref owner._calls) == 1
                    ? throw new InvalidOperationException("simulated cleanup failure")
                    : inner.CreateDbContextAsync(cancellationToken);
        }
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Entries.Add((logLevel, formatter(state, exception)));
        }
    }
}
