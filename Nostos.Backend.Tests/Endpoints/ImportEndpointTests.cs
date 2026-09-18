using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Tests.Support;
using Nostos.Backend.Workers;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

/// <summary>
/// Full-host coverage for the background-import feed (issue #189).
///
/// The interesting case is the one a running job CANNOT cover: an import that was
/// in flight when the process died. The job store is in memory, so nothing about
/// it survives — only the book row does, and the reconciliation worker marks it
/// Failed on the next start. These tests seed exactly that row before the host
/// starts, so the feed is asked the question a freshly loaded page asks after a
/// restart: "what happened to my import?".
/// </summary>
public sealed class ImportEndpointTests : IClassFixture<LibraryEndpointFactory>
{
    private readonly LibraryEndpointFactory _factory;

    /// <summary>
    /// Static because xunit builds a NEW test-class instance per test method while
    /// the fixture's database is shared: a per-instance id would try to seed the
    /// same unique (provider, external, asset) acquisition row once per method and
    /// fail the second time.
    /// </summary>
    private static readonly Guid InterruptedBookId = Guid.NewGuid();

    public ImportEndpointTests(LibraryEndpointFactory factory)
    {
        _factory = factory;

        // Seeded before the host (and with it the reconciliation worker) starts:
        // the worker must be the thing that marks this row Failed, or the test
        // would be proving its own setup rather than the feed.
        SeedInterruptedImport();
    }

    private HttpClient Client => _factory.CreateClient();

    [Fact]
    public async Task Active_list_reports_a_restart_interrupted_import_as_failed()
    {
        var entries = await Client.GetFromJsonAsync<List<ImportActivityDto>>("/api/imports/active");

        var entry = entries!.Single(e => e.BookId == InterruptedBookId);

        entry.Source.Should().Be("reconciled");
        entry.State.Should().Be("failed");
        entry.Stage.Should().Be("failed");
        // Never 100: the file never landed, so there is nothing to claim progress about.
        entry.Percent.Should().Be(0);
        entry.ErrorCode.Should().Be("import_interrupted");
        entry.Message.Should().Be(AcquisitionReconciliationWorker.InterruptedByRestartMessage);

        // Enriched from the book row, so the UI can name what failed...
        entry.Title.Should().Be("Interrupted Import");
        entry.Author.Should().Be("Ada Lovelace");

        // ...and retryable, because the acquisition row still knows the source.
        entry.CanRetry.Should().BeTrue();
        entry.ProviderId.Should().Be("fake-provider");
        entry.ExternalId.Should().Be("external-1");
        entry.AssetId.Should().Be("asset-1");
    }

    [Fact]
    public async Task Active_list_does_not_report_books_that_failed_for_other_reasons()
    {
        await using (var db = await OpenDbAsync())
        {
            var unrelated = new PhysicalBookModel
            {
                Id = Guid.NewGuid(),
                Title = "Failed For Another Reason",
                Author = "Someone",
                // A REAL failure (a broken download, a refused source), not a
                // restart. It must not be dressed up as an interrupted import.
                Status = BookStatus.Failed,
                StatusMessage = "The source refused the download.",
            };
            db.PhysicalBooks.Add(unrelated);
            await db.SaveChangesAsync();

            var entries =
                await Client.GetFromJsonAsync<List<ImportActivityDto>>("/api/imports/active");

            entries!.Should().NotContain(e => e.BookId == unrelated.Id);
        }
    }

    [Fact]
    public async Task Stream_sends_event_stream_frames_with_proxy_safe_headers()
    {
        // A one-second heartbeat, so the comment frame can be observed without a
        // fifteen-second test.
        using var factory = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["Imports:StreamHeartbeatSeconds"] = "1",
                })));

        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/imports/stream");
        using var response = await client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("text/event-stream");
        // These two are what keep a reverse proxy from buffering the feed into a
        // single delivery at the end: without them the bar sits at 0% and then
        // jumps to done.
        response.Headers.CacheControl!.NoCache.Should().BeTrue();
        response.Headers.GetValues("X-Accel-Buffering").Should().ContainSingle().Which.Should().Be("no");

        var body = await ReadFor(response, TimeSpan.FromSeconds(6));

        // The interrupted import is terminal from its first appearance, so it is
        // announced once as a failure...
        body.Should().Contain("event: failed");
        body.Should().Contain("import_interrupted");
        // ...and the current list is always the first thing a client is told.
        body.Should().Contain("event: progress");
        body.Should().Contain("\"source\":\"reconciled\"");
        // An idle connection is kept alive by a comment line the client ignores.
        body.Should().Contain(": ping");
    }

    /// <summary>
    /// Reads for a fixed wall-clock budget and returns what arrived.
    ///
    /// A stream has no end, so the test cannot await the whole body; it takes a
    /// slice and closes. Reading with a cap also proves the frames actually LEAVE
    /// the process rather than sitting in a buffer until completion.
    /// </summary>
    private static async Task<string> ReadFor(HttpResponseMessage response, TimeSpan budget)
    {
        using var cts = new CancellationTokenSource(budget);
        await using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        var text = new System.Text.StringBuilder();
        var buffer = new char[2048];

        try
        {
            while (!cts.IsCancellationRequested)
            {
                var read = await reader.ReadAsync(buffer, cts.Token);
                if (read <= 0)
                    break;

                text.Append(buffer, 0, read);
            }
        }
        catch (OperationCanceledException)
        {
            // The read budget elapsed. That is the expected exit.
        }

        return text.ToString();
    }

    private void SeedInterruptedImport()
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={_factory.DatabasePath}")
            .Options;

        using var db = new NostosDbContext(options);

        if (db.PhysicalBooks.Any(b => b.Id == InterruptedBookId))
            return;

        var book = new PhysicalBookModel
        {
            Id = InterruptedBookId,
            Title = "Interrupted Import",
            Author = "Ada Lovelace",
            // What a killed process leaves behind: the row is neither Ready nor
            // Failed until the next start reconciles it.
            Status = BookStatus.Downloading,
        };

        db.PhysicalBooks.Add(book);
        db.BookAcquisitions.Add(new BookAcquisitionModel
        {
            BookId = InterruptedBookId,
            ProviderId = "fake-provider",
            ProviderDisplayName = "Fake Provider",
            ExternalId = "external-1",
            AssetId = "asset-1",
        });

        db.SaveChanges();
    }

    private async Task<NostosDbContext> OpenDbAsync()
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={_factory.DatabasePath}")
            .Options;

        var db = new NostosDbContext(options);
        await db.Database.OpenConnectionAsync();
        return db;
    }
}
