using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Workers;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 5C — the reading notification scanner worker. The background loop is
// deliberately thin: each cycle resolves the scoped outbox and enqueues, so
// the worker tests drive ScanOnceAsync directly against a fake scoped outbox
// and verify the loop survives a failed cycle without starting real workers.
public sealed class ReadingNotificationWorkerTests
{
    [Fact]
    public async Task ScanOnce_ResolvesScopedOutbox_AndEnqueuesOncePerScan()
    {
        CountingOutbox.Reset();
        var services = new ServiceCollection();
        services.AddScoped<CountingOutbox>();
        services.AddScoped<IReadingNotificationOutbox>(sp => sp.GetRequiredService<CountingOutbox>());
        await using var provider = services.BuildServiceProvider();

        var worker = new ReadingNotificationWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new ReadingTrainingOptions { NotificationPollSeconds = 1 },
            NullLogger<ReadingNotificationWorker>.Instance);

        await worker.ScanOnceAsync();
        await worker.ScanOnceAsync();

        // One fresh scoped instance per scan (a root-scoped resolution would
        // have reused a single instance) and exactly one enqueue per scan.
        CountingOutbox.Created.Should().Be(2);
        CountingOutbox.EnqueueCalls.Should().Be(2);
        CountingOutbox.LastEnqueueResult.Should().Be(1);
    }

    [Fact]
    public async Task ExecuteAsync_ScansImmediately_ContinuesAfterFailedCycle_AndStopsGracefully()
    {
        FlakyOutbox.Reset();
        var services = new ServiceCollection();
        services.AddScoped<FlakyOutbox>();
        services.AddScoped<IReadingNotificationOutbox>(sp => sp.GetRequiredService<FlakyOutbox>());
        await using var provider = services.BuildServiceProvider();

        var worker = new ReadingNotificationWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new ReadingTrainingOptions { NotificationPollSeconds = 1 },
            NullLogger<ReadingNotificationWorker>.Instance);

        using var cts = new CancellationTokenSource();
        var run = worker.StartAsync(cts.Token);

        // The first cycle (the immediate startup scan) throws; the loop must
        // survive it and poll again one interval later. Bound the wait so a
        // regression can never hang the suite.
        await FlakyOutbox.SecondScanStarted.WaitAsync(TimeSpan.FromSeconds(15));

        cts.Cancel();
        await run;

        FlakyOutbox.EnqueueCalls.Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public async Task ExecuteAsync_ClampsPollInterval_ToCalmWindow()
    {
        // The clamp is applied when the loop starts: extreme configured
        // values collapse to the 1..300s window.
        ReadingNotificationWorker.MinPollSeconds.Should().Be(1);
        ReadingNotificationWorker.MaxPollSeconds.Should().Be(300);

        FlakyOutbox.Reset();
        var services = new ServiceCollection();
        services.AddScoped<FlakyOutbox>();
        services.AddScoped<IReadingNotificationOutbox>(sp => sp.GetRequiredService<FlakyOutbox>());
        await using var provider = services.BuildServiceProvider();

        // Configured far outside the window; the worker must still run.
        var worker = new ReadingNotificationWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new ReadingTrainingOptions { NotificationPollSeconds = -5 },
            NullLogger<ReadingNotificationWorker>.Instance);

        using var cts = new CancellationTokenSource();
        var run = worker.StartAsync(cts.Token);
        await FlakyOutbox.SecondScanStarted.WaitAsync(TimeSpan.FromSeconds(15));
        cts.Cancel();
        await run;
    }

    private sealed class CountingOutbox : IReadingNotificationOutbox
    {
        public static int Created;
        public static int EnqueueCalls;
        public static int LastEnqueueResult;

        public static void Reset()
        {
            Created = 0;
            EnqueueCalls = 0;
            LastEnqueueResult = 0;
        }

        public CountingOutbox() => Created++;

        public Task<int> EnqueueTargetReachedAsync(CancellationToken cancellationToken = default)
        {
            EnqueueCalls++;
            LastEnqueueResult = 1;
            return Task.FromResult(1);
        }

        public Task<IReadOnlyList<ClaimedReadingNotification>> ClaimDueAsync(
            int maxCount, TimeSpan lease, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> AcknowledgeAsync(Guid id, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class FlakyOutbox : IReadingNotificationOutbox
    {
        private static int _calls;
        private static TaskCompletionSource _secondScanStarted =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public static Task SecondScanStarted => _secondScanStarted.Task;

        public static int EnqueueCalls => Volatile.Read(ref _calls);

        public static void Reset()
        {
            _calls = 0;
            _secondScanStarted = new TaskCompletionSource(
                TaskCreationOptions.RunContinuationsAsynchronously);
        }

        public Task<int> EnqueueTargetReachedAsync(CancellationToken cancellationToken = default)
        {
            var call = Interlocked.Increment(ref _calls);
            if (call == 1)
            {
                throw new InvalidOperationException("First scan cycle fails.");
            }
            if (call == 2)
            {
                _secondScanStarted.TrySetResult();
            }
            return Task.FromResult(0);
        }

        public Task<IReadOnlyList<ClaimedReadingNotification>> ClaimDueAsync(
            int maxCount, TimeSpan lease, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> AcknowledgeAsync(Guid id, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
