using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

/// <summary>
/// The 99% rule (issue #189): an import that has not finished must never report
/// 100%.
///
/// This is not cosmetic. A running acquisition can honestly report 100% of its
/// own work — every byte is downloaded — while the row is still being committed
/// and the file moved into place, and a UI that renders "100%" (or treats it as
/// Ready) at that moment offers a Play button for a file that is not there yet.
/// 100 is a claim about the LIBRARY, so only a terminal Succeeded state may make
/// it.
///
/// Three levels, because each can break independently: the record's rule, the
/// endpoint's use of it, and the real job store's running path.
/// </summary>
public sealed class ImportCapTests
{
    [Theory]
    // Every state that has not finished is capped, whatever the raw number says.
    [InlineData(AcquisitionJobState.Queued, 100, 99)]
    [InlineData(AcquisitionJobState.Running, 100, 99)]
    [InlineData(AcquisitionJobState.Failed, 100, 99)]
    [InlineData(AcquisitionJobState.Cancelled, 100, 99)]
    // Only Succeeded may claim it.
    [InlineData(AcquisitionJobState.Succeeded, 100, 100)]
    // And nothing is bent on the way through.
    [InlineData(AcquisitionJobState.Running, 42, 42)]
    [InlineData(AcquisitionJobState.Succeeded, 42, 42)]
    [InlineData(AcquisitionJobState.Running, 150, 99)]
    [InlineData(AcquisitionJobState.Running, -5, 0)]
    public void Reported_percent_caps_everything_but_success(
        AcquisitionJobState state, int raw, int expected)
    {
        var status = StatusOf(state, raw);

        status.ReportedPercent.Should().Be(expected);
    }

    [Fact]
    public async Task Active_list_uses_the_cap_rather_than_the_raw_percent()
    {
        var manager = new StubJobManager();
        manager.Jobs.Add(StatusOf(AcquisitionJobState.Running, 100, "job-running"));
        manager.Jobs.Add(StatusOf(AcquisitionJobState.Succeeded, 100, "job-done"));

        // Built without the shared fixture: this test needs its own host so the
        // stub can be the manager the endpoints resolve. The real manager is
        // removed rather than merely shadowed — "the last registration wins" is
        // true but silent, and a test that relies on descriptor order would keep
        // passing while testing the wrong object.
        using var factory = new LibraryEndpointFactory();
        using var host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IAcquisitionJobManager>();
                services.AddSingleton<IAcquisitionJobManager>(manager);
            }));

        using var client = host.CreateClient();

        // The premise of this test, asserted rather than assumed: the stub is the
        // manager the endpoint resolves.
        host.Services.GetRequiredService<IAcquisitionJobManager>().Should().BeSameAs(manager);

        var entries = await client.GetFromJsonAsync<List<ImportActivityDto>>("/api/imports/active");

        // A RUNNING job whose stored percent is already 100 is reported at 99...
        var running = entries!.Single(e => e.Id == "job-running");
        running.State.Should().Be("running");
        running.Percent.Should().Be(99);

        // ...and a job that has finished is not in the in-flight list at all. Its
        // 100 belongs to the "done" event and to the library row, not to a
        // progress bar that would then be stuck at full while nothing has landed.
        entries.Should().NotContain(e => e.Id == "job-done");
    }

    [Fact]
    public async Task A_running_job_that_reports_100_percent_is_reported_at_99()
    {
        // The real job store, drained by its real worker, with the acquisition
        // service replaced by one that reports 100% and then holds: the exact
        // window the cap exists for.
        var service = new BlockingAcquisitionService();
        var manager = new AcquisitionJobManager(
            new StubScopeFactory(service),
            Options.Create(new AcquisitionOptions()),
            NullLogger<AcquisitionJobManager>.Instance);

        await manager.StartAsync(CancellationToken.None);

        try
        {
            var started = manager.Start(new AcquisitionRequest("fake-provider", "external-1"));

            await service.HasReported.Task.WaitAsync(TimeSpan.FromSeconds(10));

            var whileRunning = manager.Get(started.JobId)!;
            whileRunning.State.Should().Be(AcquisitionJobState.Running);
            // The store keeps what it was told; the client-facing value is capped.
            whileRunning.Percent.Should().Be(100);
            whileRunning.ReportedPercent.Should().Be(99);

            service.Release();

            var succeeded = await WaitForFinishedAsync(manager, started.JobId);
            succeeded.State.Should().Be(AcquisitionJobState.Succeeded);
            succeeded.ReportedPercent.Should().Be(100);
        }
        finally
        {
            await manager.StopAsync(CancellationToken.None);
        }
    }

    private static async Task<AcquisitionJobStatus> WaitForFinishedAsync(
        AcquisitionJobManager manager, string jobId)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);

        while (DateTime.UtcNow < deadline)
        {
            var status = manager.Get(jobId);
            if (status is not null && status.IsFinished)
                return status;

            await Task.Delay(25);
        }

        throw new TimeoutException($"Job {jobId} never finished.");
    }

    private static AcquisitionJobStatus StatusOf(
        AcquisitionJobState state, int percent, string jobId = "job-1") =>
        new(
            JobId: jobId,
            State: state,
            Stage: "downloading",
            Percent: percent,
            Detail: null,
            ProviderId: "fake-provider",
            ExternalId: "external-1",
            AssetId: null,
            BookId: null,
            ErrorCode: null,
            Message: null,
            CreatedAt: DateTime.UtcNow,
            UpdatedAt: DateTime.UtcNow);

    /// <summary>A job manager the endpoints can read without doing any work.</summary>
    private sealed class StubJobManager : IAcquisitionJobManager
    {
        public List<AcquisitionJobStatus> Jobs { get; } = new();

        public AcquisitionJobStatus Start(AcquisitionRequest request) =>
            throw new NotSupportedException("The stub only serves reads.");

        public AcquisitionJobStatus? Get(string jobId) =>
            Jobs.FirstOrDefault(job => job.JobId == jobId);

        public IReadOnlyList<AcquisitionJobStatus> List() => Jobs;

        public IReadOnlyList<AcquisitionJobStatus> ListActive() =>
            Jobs.Where(job => !job.IsFinished).ToList();

        public bool Cancel(string jobId) => false;
    }

    /// <summary>
    /// Reports 100% and then blocks until released, so the test can look at the
    /// job store while the acquisition is genuinely still in flight.
    /// </summary>
    private sealed class BlockingAcquisitionService : IAcquisitionService
    {
        private readonly TaskCompletionSource _release =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource HasReported { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<AcquisitionResult> AcquireAsync(
            AcquisitionRequest request,
            IProgress<AcquisitionProgress>? progress,
            CancellationToken ct)
        {
            progress?.Report(new AcquisitionProgress("importing", 100, "M4B audiobook"));
            HasReported.TrySetResult();

            await _release.Task.WaitAsync(ct);

            return new AcquisitionResult(AcquisitionOutcome.Acquired, Guid.NewGuid(), null, "Imported.");
        }

        public void Release() => _release.TrySetResult();
    }

    /// <summary>
    /// The manager resolves the scoped acquisition service from a scope, so the
    /// test provides exactly that and nothing else.
    /// </summary>
    private sealed class StubScopeFactory(IAcquisitionService service) : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => new Scope(service);

        private sealed class Scope(IAcquisitionService service) : IServiceScope
        {
            public IServiceProvider ServiceProvider { get; } = new Provider(service);

            public void Dispose()
            {
            }
        }

        private sealed class Provider(IAcquisitionService service) : IServiceProvider
        {
            public object? GetService(Type serviceType) =>
                serviceType == typeof(IAcquisitionService) ? service : null;
        }
    }
}
