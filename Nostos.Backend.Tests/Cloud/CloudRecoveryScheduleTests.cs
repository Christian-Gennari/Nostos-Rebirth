using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Recovery;
using Nostos.Backend.Cloud.Runtime;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudRecoveryScheduleTests
{
    [Fact]
    [Trait("Category", "CloudRecoverySchedule")]
    public void Cloud_mode_registers_the_scheduled_backup_worker()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CloudRecoverySchedule:Enabled"] = "true",
            })
            .Build();

        var deployment = DeploymentDescriptor.For(DeploymentMode.Cloud);

        services.AddNostosCloudRecoverySchedule(configuration, deployment);

        var provider = services.BuildServiceProvider();

        var options = provider.GetService<CloudRecoveryScheduleOptions>();
        options.Should().NotBeNull();

        var hostedServices = services
            .Where(d => d.ServiceType == typeof(IHostedService))
            .ToList();

        hostedServices
            .Should().Contain(d =>
                d.ImplementationType == typeof(CloudScheduledBackupWorker));

        services
            .Should().Contain(d =>
                d.ServiceType == typeof(CloudBackupSweepRunner)
                && d.Lifetime == ServiceLifetime.Scoped);
    }

    [Fact]
    [Trait("Category", "CloudRecoverySchedule")]
    public void SelfHosted_mode_does_not_register_the_scheduled_backup_worker()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CloudRecoverySchedule:Enabled"] = "true",
            })
            .Build();

        var deployment = DeploymentDescriptor.For(DeploymentMode.SelfHosted);

        services.AddNostosCloudRecoverySchedule(configuration, deployment);

        var provider = services.BuildServiceProvider();

        var options = provider.GetService<CloudRecoveryScheduleOptions>();
        options.Should().BeNull();

        var hostedServices = services
            .Where(d => d.ServiceType == typeof(IHostedService))
            .ToList();

        hostedServices
            .Should().NotContain(d =>
                d.ImplementationType == typeof(CloudScheduledBackupWorker));
    }

    [Fact]
    [Trait("Category", "CloudRecoverySchedule")]
    public async Task Disabled_schedule_never_executes_a_sweep()
    {
        var store = new FakeControlPlaneStore();
        var services = BuildTestServices(store);
        var provider = services.BuildServiceProvider();

        var options = new CloudRecoveryScheduleOptions { Enabled = false };
        var runner = provider.GetRequiredService<CloudBackupSweepRunner>();
        var logger = new FakeLogger<CloudScheduledBackupWorker>();
        var worker = new CloudScheduledBackupWorker(
            options,
            runner,
            new AlwaysOwnedLeaseManager(),
            logger);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        await worker.StartAsync(cts.Token);
        await Task.Delay(100);
        await worker.StopAsync(CancellationToken.None);

        store.ListAsyncCalled.Should().BeFalse();
    }

    [Fact]
    [Trait("Category", "CloudRecoverySchedule")]
    public void NextOccurrence_returns_correct_values()
    {
        var options = new CloudRecoveryScheduleOptions
        {
            Enabled = true,
            HourUtc = 2,
            MinuteUtc = 30,
        };

        var beforeTime = new DateTimeOffset(
            2026, 9, 23, 1, 0, 0, TimeSpan.Zero);
        var exactTime = new DateTimeOffset(
            2026, 9, 23, 2, 30, 0, TimeSpan.Zero);
        var afterTime = new DateTimeOffset(
            2026, 9, 23, 3, 0, 0, TimeSpan.Zero);

        var nextFromBefore = options.NextOccurrence(beforeTime);
        nextFromBefore.Should().NotBeNull();
        nextFromBefore!.Value.Should().Be(
            new DateTimeOffset(2026, 9, 23, 2, 30, 0, TimeSpan.Zero));

        var nextFromExact = options.NextOccurrence(exactTime);
        nextFromExact.Should().NotBeNull();
        nextFromExact!.Value.Should().Be(
            new DateTimeOffset(2026, 9, 24, 2, 30, 0, TimeSpan.Zero));

        var nextFromAfter = options.NextOccurrence(afterTime);
        nextFromAfter.Should().NotBeNull();
        nextFromAfter!.Value.Should().Be(
            new DateTimeOffset(2026, 9, 24, 2, 30, 0, TimeSpan.Zero));

        options.Enabled = false;
        options.NextOccurrence(beforeTime).Should().BeNull();
    }

    [Fact]
    [Trait("Category", "CloudRecoverySchedule")]
    public async Task Worker_does_not_sweep_immediately_at_startup()
    {
        var store = new FakeControlPlaneStore();
        var services = BuildTestServices(store);
        var provider = services.BuildServiceProvider();

        var options = new CloudRecoveryScheduleOptions
        {
            Enabled = true,
            HourUtc = 23,
            MinuteUtc = 59,
        };

        var runner = provider.GetRequiredService<CloudBackupSweepRunner>();
        var logger = new FakeLogger<CloudScheduledBackupWorker>();
        var worker = new CloudScheduledBackupWorker(
            options,
            runner,
            new AlwaysOwnedLeaseManager(),
            logger);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await worker.StartAsync(cts.Token);
        await Task.Delay(50);
        await worker.StopAsync(CancellationToken.None);

        store.ListAsyncCalled.Should().BeFalse();

        var now = DateTimeOffset.UtcNow;
        var next = options.NextOccurrence(now);
        next.Should().NotBeNull();
        (next!.Value - now).Should().BeGreaterThan(TimeSpan.FromMilliseconds(50));
    }

    [Fact]
    [Trait("Category", "CloudRecoverySchedule")]
    public async Task Cancellation_exits_cleanly_without_error()
    {
        var store = new FakeControlPlaneStore();
        var services = BuildTestServices(store);
        var provider = services.BuildServiceProvider();

        var options = new CloudRecoveryScheduleOptions
        {
            Enabled = true,
            HourUtc = 0,
            MinuteUtc = 30,
        };

        var runner = provider.GetRequiredService<CloudBackupSweepRunner>();
        var logger = new FakeLogger<CloudScheduledBackupWorker>();
        var worker = new CloudScheduledBackupWorker(
            options,
            runner,
            new AlwaysOwnedLeaseManager(),
            logger);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        var startTask = worker.StartAsync(cts.Token);
        await Task.Delay(50);
        cts.Cancel();

        var stopTask = worker.StopAsync(CancellationToken.None);

        await Task.WhenAny(startTask, Task.Delay(500));
        await Task.WhenAny(stopTask, Task.Delay(500));

        logger.ErrorMessages.Should().BeEmpty();
    }

    private static ServiceCollection BuildTestServices(FakeControlPlaneStore store)
    {
        var services = new ServiceCollection();
        services.AddSingleton(store);
        services.AddSingleton<ICloudControlPlaneStore>(store);
        services.AddLogging();
        services.AddScoped<CloudTenantContextScope>();
        services.AddScoped<ICloudRecoveryService, FakeRecoveryService>();
        services.AddScoped<CloudBackupSweepRunner>();
        return services;
    }

    private sealed class FakeControlPlaneStore : ICloudControlPlaneStore
    {
        public bool ListAsyncCalled { get; private set; }

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default)
        {
            ListAsyncCalled = true;
            return Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>([]);
        }

        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<CloudAccountResourceSnapshot?>(null);

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }

    private sealed class FakeRecoveryService : ICloudRecoveryService
    {
        public Task<CloudOperationalBackupSummary> CreateBackupAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CloudOperationalBackupSummary(
                Guid.NewGuid(),
                DateTime.UtcNow,
                "1",
                new PortableArchiveCounts(0, 0, 0, 0, 0, 0, 0, 0, 0),
                0,
                0,
                100,
                "abc"));

        public Task<IReadOnlyList<CloudOperationalBackupSummary>> ListBackupsAsync(
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<CloudRestoreResult> RestoreAsync(
            Guid backupId,
            bool confirmed,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }

    private sealed class AlwaysOwnedLeaseManager : ICloudWorkerLeaseManager
    {
        public Task<IAsyncDisposable?> TryAcquireAsync(
            string leaseName,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IAsyncDisposable?>(new Lease());

        private sealed class Lease : IAsyncDisposable
        {
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private sealed class FakeLogger<T> : ILogger<T>
    {
        public List<string> ErrorMessages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (logLevel >= LogLevel.Error)
                ErrorMessages.Add(formatter(state, exception));
        }
    }
}
