using System.Reflection;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Recovery;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudBackupSweepTests
{
    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public async Task Only_eligible_tenants_are_attempted()
    {
        var accountReady = NostosAccountId.FromExternalIdentity("issuer", "ready");
        var accountPending = NostosAccountId.FromExternalIdentity("issuer", "pending");
        var accountDisabled = NostosAccountId.FromExternalIdentity("issuer", "disabled");
        var accountIncompatible = NostosAccountId.FromExternalIdentity("issuer", "incompatible");

        var snapshots = new List<CloudAccountResourceSnapshot>
        {
            CreateSnapshot(accountReady, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
            CreateSnapshot(accountPending, CloudProvisioningState.Pending, CloudAccountStatus.Unknown, null),
            CreateSnapshot(accountDisabled, CloudProvisioningState.Ready, CloudAccountStatus.Disabled, CloudCustomerSchema.CurrentVersion),
            CreateSnapshot(accountIncompatible, CloudProvisioningState.Ready, CloudAccountStatus.Active, "incompatible-version"),
        };

        var controlPlane = new FakeControlPlaneStore(snapshots);
        var recorder = new BackupRecorder();
        var scopeFactory = new FakeScopeFactory(recorder);
        var logger = new FakeLogger<CloudBackupSweepRunner>();

        var runner = new CloudBackupSweepRunner(controlPlane, scopeFactory, logger);
        var result = await runner.RunAsync();

        result.Attempted.Should().Be(1);
        result.Succeeded.Should().Be(1);
        result.Failed.Should().Be(0);
        result.Tenants.Should().HaveCount(1);
        result.Tenants[0].AccountId.Should().Be(accountReady.Value);
    }

    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public async Task Each_eligible_tenant_receives_exactly_one_backup_request()
    {
        var accountA = NostosAccountId.FromExternalIdentity("issuer", "a");
        var accountB = NostosAccountId.FromExternalIdentity("issuer", "b");
        var accountC = NostosAccountId.FromExternalIdentity("issuer", "c");

        var snapshots = new List<CloudAccountResourceSnapshot>
        {
            CreateSnapshot(accountA, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
            CreateSnapshot(accountB, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
            CreateSnapshot(accountC, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
        };

        var controlPlane = new FakeControlPlaneStore(snapshots);
        var recorder = new BackupRecorder();
        var scopeFactory = new FakeScopeFactory(recorder);
        var logger = new FakeLogger<CloudBackupSweepRunner>();

        var runner = new CloudBackupSweepRunner(controlPlane, scopeFactory, logger);
        var result = await runner.RunAsync();

        result.Attempted.Should().Be(3);
        result.Succeeded.Should().Be(3);
        result.Failed.Should().Be(0);

        recorder.BackupRequests.Should().HaveCount(3);
        recorder.BackupRequests.Select(r => r.AccountId).Should().BeEquivalentTo(
            [accountA.Value, accountB.Value, accountC.Value]);
    }

    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public async Task Tenant_failure_does_not_prevent_other_tenants()
    {
        var accountA = NostosAccountId.FromExternalIdentity("issuer", "a");
        var accountB = NostosAccountId.FromExternalIdentity("issuer", "b");

        var snapshots = new List<CloudAccountResourceSnapshot>
        {
            CreateSnapshot(accountA, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
            CreateSnapshot(accountB, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
        };

        var controlPlane = new FakeControlPlaneStore(snapshots);
        var recorder = new BackupRecorder { FailAccountId = accountA.Value };
        var scopeFactory = new FakeScopeFactory(recorder);
        var logger = new FakeLogger<CloudBackupSweepRunner>();

        var runner = new CloudBackupSweepRunner(controlPlane, scopeFactory, logger);
        var result = await runner.RunAsync();

        result.Attempted.Should().Be(2);
        result.Succeeded.Should().Be(1);
        result.Failed.Should().Be(1);
        result.Tenants.Should().HaveCount(2);

        var failedTenant = result.Tenants.Single(t => t.AccountId == accountA.Value);
        failedTenant.BackupId.Should().BeNull();
        failedTenant.ErrorMessage.Should().NotBeNullOrEmpty();

        var succeededTenant = result.Tenants.Single(t => t.AccountId == accountB.Value);
        succeededTenant.BackupId.Should().NotBeNull();
        succeededTenant.ErrorMessage.Should().BeNull();
    }

    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public async Task Failure_diagnostics_do_not_emit_provider_or_connection_details()
    {
        var account = NostosAccountId.FromExternalIdentity("issuer", "redaction");
        var snapshots = new List<CloudAccountResourceSnapshot>
        {
            CreateSnapshot(
                account,
                CloudProvisioningState.Ready,
                CloudAccountStatus.Active,
                CloudCustomerSchema.CurrentVersion),
        };

        const string secret = "Password=do-not-log-this";
        var recorder = new BackupRecorder
        {
            FailAccountId = account.Value,
            FailureMessage = secret,
        };
        var logger = new FakeLogger<CloudBackupSweepRunner>();
        var runner = new CloudBackupSweepRunner(
            new FakeControlPlaneStore(snapshots),
            new FakeScopeFactory(recorder),
            logger);

        var result = await runner.RunAsync();

        result.Failed.Should().Be(1);
        result.Tenants.Single().ErrorMessage.Should().Be("backup_failed");
        logger.Messages.Should().NotContain(message => message.Contains(secret, StringComparison.Ordinal));
        logger.Exceptions.Should().OnlyContain(exception => exception == null);
    }

    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public async Task Processing_is_strictly_sequential()
    {
        var accountA = NostosAccountId.FromExternalIdentity("issuer", "a");
        var accountB = NostosAccountId.FromExternalIdentity("issuer", "b");

        var snapshots = new List<CloudAccountResourceSnapshot>
        {
            CreateSnapshot(accountA, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
            CreateSnapshot(accountB, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
        };

        var controlPlane = new FakeControlPlaneStore(snapshots);
        var recorder = new BackupRecorder { DelayMs = 50 };
        var scopeFactory = new FakeScopeFactory(recorder);
        var logger = new FakeLogger<CloudBackupSweepRunner>();

        var runner = new CloudBackupSweepRunner(controlPlane, scopeFactory, logger);
        await runner.RunAsync();

        recorder.MaxConcurrency.Should().Be(1);
    }

    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public void RunAsync_accepts_only_CancellationToken_proving_no_client_supplied_identifiers()
    {
        var method = typeof(CloudBackupSweepRunner).GetMethod(
            nameof(CloudBackupSweepRunner.RunAsync),
            BindingFlags.Public | BindingFlags.Instance);

        method.Should().NotBeNull();

        var parameters = method!.GetParameters();
        parameters.Should().HaveCount(1);
        parameters[0].ParameterType.Should().Be(typeof(CancellationToken));
        parameters[0].Name.Should().Be("cancellationToken");
        parameters[0].HasDefaultValue.Should().BeTrue();
    }

    [Fact]
    [Trait("Category", "CloudBackupSweep")]
    public async Task Overlapping_run_guard_prevents_concurrent_sweep()
    {
        var accountA = NostosAccountId.FromExternalIdentity("issuer", "a");

        var snapshots = new List<CloudAccountResourceSnapshot>
        {
            CreateSnapshot(accountA, CloudProvisioningState.Ready, CloudAccountStatus.Active, CloudCustomerSchema.CurrentVersion),
        };

        var controlPlane = new FakeControlPlaneStore(snapshots);
        var recorder = new BackupRecorder { DelayMs = 200 };
        var scopeFactory = new FakeScopeFactory(recorder);
        var logger = new FakeLogger<CloudBackupSweepRunner>();

        var runner = new CloudBackupSweepRunner(controlPlane, scopeFactory, logger);

        var firstRun = runner.RunAsync();
        await Task.Delay(50);

        var secondRun = await runner.RunAsync();

        secondRun.Attempted.Should().Be(0);
        secondRun.ControlPlaneError.Should().Be("overlapping_sweep_rejected");

        var firstResult = await firstRun;
        firstResult.Attempted.Should().Be(1);
    }

    private static CloudAccountResourceSnapshot CreateSnapshot(
        NostosAccountId accountId,
        CloudProvisioningState provisioningState,
        CloudAccountStatus accountStatus,
        string? schemaVersion)
    {
        var now = DateTime.UtcNow;
        return new CloudAccountResourceSnapshot(
            accountId,
            Guid.NewGuid(),
            $"db_{accountId.Value:N}",
            $"storage/{accountId.Value:N}",
            provisioningState,
            accountStatus,
            schemaVersion,
            FailureCode: null,
            now,
            now,
            now,
            now);
    }

    private sealed class FakeControlPlaneStore(
        List<CloudAccountResourceSnapshot> snapshots)
        : ICloudControlPlaneStore
    {
        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(snapshots.FirstOrDefault(s => s.AccountId.Equals(accountId)));

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>(snapshots);

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

    private sealed class BackupRecorder
    {
        private int _currentConcurrency;
        private int _maxConcurrency;

        public List<(Guid AccountId, Guid ResourceId)> BackupRequests { get; } = [];
        public int MaxConcurrency => _maxConcurrency;
        public Guid? FailAccountId { get; set; }
        public string FailureMessage { get; set; } = "Simulated backup failure";
        public int DelayMs { get; set; }

        public async Task<CloudOperationalBackupSummary> CreateBackupAsync(
            CloudTenantContextScope contextScope,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _currentConcurrency);

            var current = _currentConcurrency;
            if (current > _maxConcurrency)
                Interlocked.CompareExchange(ref _maxConcurrency, current, _maxConcurrency);

            try
            {
                if (DelayMs > 0)
                    await Task.Delay(DelayMs, cancellationToken);

                var context = contextScope.Current
                    ?? throw new InvalidOperationException("Context not set");

                BackupRequests.Add((context.AccountId.Value, Guid.NewGuid()));

                if (FailAccountId.HasValue && context.AccountId.Value == FailAccountId.Value)
                    throw new InvalidOperationException(FailureMessage);

                return new CloudOperationalBackupSummary(
                    Guid.NewGuid(),
                    DateTime.UtcNow,
                    CloudCustomerSchema.CurrentVersion,
                    new PortableArchiveCounts(0, 0, 0, 0, 0, 0, 0, 0, 0),
                    0,
                    0,
                    100,
                    "abc123");
            }
            finally
            {
                Interlocked.Decrement(ref _currentConcurrency);
            }
        }
    }

    private sealed class FakeScopeFactory(BackupRecorder recorder) : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => new FakeScope(recorder);
    }

    private sealed class FakeScope(BackupRecorder recorder) : IServiceScope
    {
        private readonly CloudTenantContextScope _contextScope = new();

        public IServiceProvider ServiceProvider => new FakeServiceProvider(
            _contextScope,
            recorder);

        public void Dispose() { }
    }

    private sealed class FakeServiceProvider(
        CloudTenantContextScope contextScope,
        BackupRecorder recorder) : IServiceProvider
    {
        public object? GetService(Type serviceType)
        {
            if (serviceType == typeof(CloudTenantContextScope))
                return contextScope;
            if (serviceType == typeof(ICloudRecoveryService))
                return new FakeRecoveryService(contextScope, recorder);
            throw new InvalidOperationException($"Service {serviceType} not registered");
        }
    }

    private sealed class FakeRecoveryService(
        CloudTenantContextScope contextScope,
        BackupRecorder recorder) : ICloudRecoveryService
    {
        public Task<CloudOperationalBackupSummary> CreateBackupAsync(
            CancellationToken cancellationToken = default) =>
            recorder.CreateBackupAsync(contextScope, cancellationToken);

        public Task<IReadOnlyList<CloudOperationalBackupSummary>> ListBackupsAsync(
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<CloudRestoreResult> RestoreAsync(
            Guid backupId,
            bool confirmed,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }

    private sealed class FakeLogger<T> : ILogger<T>
    {
        public List<string> Messages { get; } = [];
        public List<Exception?> Exceptions { get; } = [];

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
            Messages.Add(formatter(state, exception));
            Exceptions.Add(exception);
        }
    }
}
