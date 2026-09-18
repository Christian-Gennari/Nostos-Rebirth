using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Providers;

public sealed class LiveSimulatedImportVerificationTest : IDisposable
{
    private readonly string _tempRoot;
    private readonly string _booksRoot;
    private readonly string _workingRoot;

    public LiveSimulatedImportVerificationTest()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), $"nostos-live-sim-{Guid.NewGuid():N}");
        _booksRoot = Path.Combine(_tempRoot, "books");
        _workingRoot = Path.Combine(_tempRoot, "working");
        Directory.CreateDirectory(_booksRoot);
        Directory.CreateDirectory(_workingRoot);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempRoot))
                Directory.Delete(_tempRoot, recursive: true);
        }
        catch { }
    }

    [Fact]
    public async Task LiveImport_CreatesRowAsDownloading_AndEndsAsReadyWithFile()
    {
        using var h = AcquisitionHarness.Create();

        var provider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        var plan = new ProviderAcquisitionPlan(
            ProviderId: "gutenberg",
            ExternalId: "live-101",
            Asset: new ProviderAsset("epub3", ProviderMediaKind.Ebook, "EPUB 3", "application/epub+zip"),
            Metadata: new ProviderMetadata(Title: "Live Test Book", Author: "Test Author"),
            Parts: new[]
            {
                new ProviderDownloadPart(new Uri("https://example.com/live-101.epub"), ".epub", 1024),
            },
            Output: new ProviderOutput(".epub", "application/epub+zip", "EPUB"));
        provider.PlanResult = plan;

        Guid? observedBookId = null;
        BookStatus? observedInitialStatus = null;

        // Hook download step to verify row state in DB while import is actively downloading
        h.Downloader.OnDownloadAsync = async _ =>
        {
            await using var db = await h.ContextFactory.CreateDbContextAsync();
            var bookInFlight = await db.Books.SingleOrDefaultAsync(b => b.Title == "Live Test Book");
            if (bookInFlight is not null)
            {
                observedBookId = bookInFlight.Id;
                observedInitialStatus = bookInFlight.Status;
            }
        };

        var service = h.CreateService(new ProviderRegistry(new[] { provider }));
        var request = new AcquisitionRequest("gutenberg", "live-101");

        var result = await service.AcquireAsync(request, null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Acquired);
        result.Succeeded.Should().BeTrue();

        // 1. Verify that while download was running, the row existed with Status = Downloading
        observedBookId.Should().NotBeNull("row must exist during download");
        observedInitialStatus.Should().Be(BookStatus.Downloading);

        // 2. Verify that after acquire finishes, the row is Ready with file attached
        await using var finalDb = await h.ContextFactory.CreateDbContextAsync();
        var finalBook = await finalDb.Books.SingleOrDefaultAsync(b => b.Id == observedBookId!.Value);

        finalBook.Should().NotBeNull();
        finalBook!.Status.Should().Be(BookStatus.Ready);
        finalBook.StatusMessage.Should().BeNull();
        finalBook.FileDetails.HasFile.Should().BeTrue();
        finalBook.FileDetails.FileName.Should().NotBeNullOrEmpty();

        var storedPath = h.Storage.GetBookFileName(finalBook.Id);
        storedPath.Should().NotBeNull();
        File.Exists(storedPath!).Should().BeTrue();

        Console.WriteLine($"[LIVE IMPORT VERIFIED] BookId: {finalBook.Id}, Initial Status during download: {observedInitialStatus}, Final Status: {finalBook.Status}, File: {finalBook.FileDetails.FileName}");
    }
}
