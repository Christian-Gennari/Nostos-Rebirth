using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Providers;

public sealed class AcquisitionServiceTests
{
    private static ProviderAcquisitionPlan CreateEbookPlan(
        string providerId = "fake-provider",
        string externalId = "item-123",
        string assetId = "epub-main",
        string title = "The Republic",
        string author = "Plato",
        string? partUrl = "https://example.com/item-123.epub",
        string partExtension = ".epub",
        long partBytes = 1024,
        string rights = "Public Domain in the USA")
    {
        return new ProviderAcquisitionPlan(
            ProviderId: providerId,
            ExternalId: externalId,
            Asset: new ProviderAsset(
                Id: assetId,
                Kind: ProviderMediaKind.Ebook,
                Label: "EPUB format",
                SourceFormat: "epub",
                SizeBytes: partBytes,
                IsPreferred: true),
            Metadata: new ProviderMetadata(
                Title: title,
                Author: author),
            Parts: new[]
            {
                new ProviderDownloadPart(new Uri(partUrl!), partExtension, partBytes)
            },
            Output: new ProviderOutput(".epub", "application/epub+zip", "EPUB"),
            Source: new ProviderSourceInfo(
                ItemUrl: $"https://example.com/items/{externalId}",
                RightsStatement: rights));
    }

    [Fact]
    public async Task HappyPath_SinglePart_NoAssembler_AcquiresAndRecordsProvenance()
    {
        using var h = AcquisitionHarness.Create();

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        var plan = CreateEbookPlan(
            providerId: "gutenberg",
            externalId: "1497",
            assetId: "epub3",
            title: "The Republic",
            author: "Plato",
            rights: "Public Domain");
        fakeProvider.PlanResult = plan;

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        var request = new AcquisitionRequest(
            ProviderId: "gutenberg",
            ExternalId: "1497",
            AssetId: "epub3");

        var result = await service.AcquireAsync(request, null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Acquired);
        result.Succeeded.Should().BeTrue();
        result.BookId.Should().NotBeNull();
        result.Book.Should().NotBeNull();
        result.Book!.Title.Should().Be("The Republic");
        result.Book.Author.Should().Be("Plato");
        result.Book.HasFile.Should().BeTrue();

        // Stored file exists in storage
        var storedFileName = h.Storage.GetBookFileName(result.BookId!.Value);
        storedFileName.Should().NotBeNull();
        File.Exists(storedFileName!).Should().BeTrue();

        // BookAcquisition row exists with the right values
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var acqRow = await db.BookAcquisitions.SingleOrDefaultAsync(a => a.BookId == result.BookId.Value);
        acqRow.Should().NotBeNull();
        acqRow!.ProviderId.Should().Be("gutenberg");
        acqRow.ExternalId.Should().Be("1497");
        acqRow.AssetId.Should().Be("epub3");
        acqRow.RightsStatement.Should().Be("Public Domain");
    }

    [Fact]
    public async Task AlreadyAcquired_RunTwice_SecondReturnsAlreadyAcquired_AndDownloadsOnlyOnce()
    {
        using var h = AcquisitionHarness.Create();

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        var plan = CreateEbookPlan(providerId: "gutenberg", externalId: "100", assetId: "asset-1", title: "Moby Dick");
        fakeProvider.PlanResult = plan;

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        // First run
        var request1 = new AcquisitionRequest("gutenberg", "100", "asset-1");
        var result1 = await service.AcquireAsync(request1, null, CancellationToken.None);
        result1.Outcome.Should().Be(AcquisitionOutcome.Acquired);
        h.Downloader.DownloadCallCount.Should().Be(1);

        // Second run with explicit AssetId (hits step 2 fast path)
        var request2 = new AcquisitionRequest("gutenberg", "100", "asset-1");
        var result2 = await service.AcquireAsync(request2, null, CancellationToken.None);
        result2.Outcome.Should().Be(AcquisitionOutcome.AlreadyAcquired);
        result2.BookId.Should().Be(result1.BookId);
        h.Downloader.DownloadCallCount.Should().Be(1, "should not download again on second run");

        // Third run without explicit AssetId (hits step 4 authoritative check once plan resolves)
        var request3 = new AcquisitionRequest("gutenberg", "100", null);
        var result3 = await service.AcquireAsync(request3, null, CancellationToken.None);
        result3.Outcome.Should().Be(AcquisitionOutcome.AlreadyAcquired);
        result3.BookId.Should().Be(result1.BookId);
        h.Downloader.DownloadCallCount.Should().Be(1, "should still not download again");
    }

    [Fact]
    public async Task AlreadyInLibrary_PreExistingBookWithFile_ReturnsAlreadyInLibrary_AndDoesNotDownload()
    {
        using var h = AcquisitionHarness.Create();

        // 1. Pre-create a book with title "War and Peace", author "Leo Tolstoy", type "ebook", HasFile = true
        var createResult = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest("client", $"create-{Guid.NewGuid():N}", "ebook", "War and Peace", Author: "Leo Tolstoy"),
            strictConfirmation: false);
        var bookId = ((LibraryCreateOrMatchResultDto)createResult.Data!).BookId!.Value;

        // Put a fake file into storage and attach it
        var tempFile = Path.Combine(h.WorkingRootDir, "initial.epub");
        await File.WriteAllBytesAsync(tempFile, new byte[] { 1, 2, 3 });
        await h.Storage.AdoptBookFileAsync(bookId, tempFile, "book.epub");

        await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: "client",
            IdempotencyKey: $"attach-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "book.epub",
            ProviderId: "manual",
            ProviderDisplayName: "Manual",
            ExternalId: "initial-id",
            AssetId: "initial-asset"));

        var originalFileContent = await File.ReadAllBytesAsync(h.Storage.GetBookFileName(bookId)!);

        // 2. Set up fake provider with matching metadata
        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        fakeProvider.PlanResult = CreateEbookPlan(
            providerId: "gutenberg",
            externalId: "2600",
            assetId: "epub-main",
            title: "War and Peace",
            author: "Leo Tolstoy");

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        // 3. Acquire
        var result = await service.AcquireAsync(new AcquisitionRequest("gutenberg", "2600"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.AlreadyInLibrary);
        result.BookId.Should().Be(bookId);
        h.Downloader.DownloadCallCount.Should().Be(0, "must not download at all if already in library");

        // Existing file must not be overwritten
        var currentFileContent = await File.ReadAllBytesAsync(h.Storage.GetBookFileName(bookId)!);
        currentFileContent.Should().Equal(originalFileContent);
    }

    [Fact]
    public async Task DownloadFailure_DownloaderThrowsProviderDownloadException_FailsAndCleansUp()
    {
        using var h = AcquisitionHarness.Create();

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        fakeProvider.PlanResult = CreateEbookPlan(
            providerId: "gutenberg",
            externalId: "500",
            assetId: "epub-main",
            title: "Failing Download Book");

        h.Downloader.ExceptionToThrowOnDownload = new ProviderDownloadException(
            ProviderDownloadException.NotFound, "Remote server returned 404.");

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(new AcquisitionRequest("gutenberg", "500"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be(ProviderDownloadException.NotFound);

        // No book row created
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var books = await db.Books.Where(b => b.Title == "Failing Download Book").ToListAsync();
        books.Should().BeEmpty();

        // No files left in storage
        Directory.GetFiles(h.BooksRootDir, "*", SearchOption.AllDirectories).Should().BeEmpty();

        // Staging directory is cleaned up
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    private sealed class FailingStorageDecorator(IFileStorageService inner) : IFileStorageService
    {
        public string StorageRoot => inner.StorageRoot;
        public Task<string> SaveBookFileAsync(Guid bookId, Microsoft.AspNetCore.Http.IFormFile file) => inner.SaveBookFileAsync(bookId, file);
        public Task<string> SaveBookFileAsync(Guid bookId, Stream content, string fileName, CancellationToken ct = default) => inner.SaveBookFileAsync(bookId, content, fileName, ct);
        public FileStream? GetBookFile(Guid bookId) => inner.GetBookFile(bookId);
        public string? GetBookFileName(Guid bookId) => inner.GetBookFileName(bookId);
        public bool DeleteBookFile(Guid bookId) => inner.DeleteBookFile(bookId);
        public void DeleteBookFiles(Guid bookId) => inner.DeleteBookFiles(bookId);
        public Task<string> SaveBookCoverAsync(Guid bookId, Microsoft.AspNetCore.Http.IFormFile file) => inner.SaveBookCoverAsync(bookId, file);
        public Task<string> SaveBookCoverAsync(Guid bookId, Stream content, string fileName, CancellationToken ct = default) => inner.SaveBookCoverAsync(bookId, content, fileName, ct);
        public string? GetBookCoverPath(Guid bookId) => inner.GetBookCoverPath(bookId);
        public Task<string?> GetBookCoverThumbnailPathAsync(Guid bookId, int width, CancellationToken ct = default) => inner.GetBookCoverThumbnailPathAsync(bookId, width, ct);
        public bool DeleteCover(Guid bookId) => inner.DeleteCover(bookId);

        public Task<string> AdoptBookFileAsync(Guid bookId, string sourcePath, string fileName, CancellationToken ct = default) =>
            throw new IOException("Simulated storage disk failure during adopt.");
    }

    [Fact]
    public async Task StorageFailure_AdoptBookFileAsyncThrows_RollsBackCreatedBook()
    {
        using var h = AcquisitionHarness.Create();

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        fakeProvider.PlanResult = CreateEbookPlan(
            providerId: "gutenberg",
            externalId: "501",
            assetId: "epub-main",
            title: "Storage Fail Book");

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var failingStorage = new FailingStorageDecorator(h.Storage);
        var service = h.CreateService(registry, storageOverride: failingStorage);

        var result = await service.AcquireAsync(new AcquisitionRequest("gutenberg", "501"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be("storage_failed");

        // The book created before adoption must have been rolled back
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var book = await db.Books.SingleOrDefaultAsync(b => b.Title == "Storage Fail Book");
        book.Should().BeNull("book row must be deleted on storage rollback");

        // Staging directory cleaned up
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    [Fact]
    public async Task AssemblyFailure_AssemblerThrows_FailsAndCleansUp()
    {
        using var h = AcquisitionHarness.Create();

        var assemblingProvider = new FakeAssemblingContentProvider("assembler", "Assembling Source");
        assemblingProvider.PlanResult = new ProviderAcquisitionPlan(
            ProviderId: "assembler",
            ExternalId: "multi-1",
            Asset: new ProviderAsset("audio-asset", ProviderMediaKind.Audiobook, "Full Audiobook", "mp3-multi"),
            Metadata: new ProviderMetadata(Title: "Audiobook To Assemble"),
            Parts: new[]
            {
                new ProviderDownloadPart(new Uri("https://example.com/part1.mp3"), ".mp3", 500),
                new ProviderDownloadPart(new Uri("https://example.com/part2.mp3"), ".mp3", 500),
            },
            Output: new ProviderOutput(".m4b", "audio/mp4", "M4B"));

        assemblingProvider.ExceptionToThrowOnAssemble = new InvalidOperationException("Transcode / assemble crashed");

        var registry = new ProviderRegistry(new[] { assemblingProvider });
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(new AcquisitionRequest("assembler", "multi-1"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be("acquisition_failed");

        // No book row created
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var books = await db.Books.Where(b => b.Title == "Audiobook To Assemble").ToListAsync();
        books.Should().BeEmpty();

        // Staging root contains no directories afterwards
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    [Fact]
    public async Task Validation_EmptyParts_ReturnsProviderNoDownloadableAssets()
    {
        using var h = AcquisitionHarness.Create();

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        fakeProvider.PlanResult = new ProviderAcquisitionPlan(
            ProviderId: "gutenberg",
            ExternalId: "empty-parts",
            Asset: new ProviderAsset("asset-1", ProviderMediaKind.Ebook, "Asset", "epub"),
            Metadata: new ProviderMetadata("Book Title"),
            Parts: Array.Empty<ProviderDownloadPart>(),
            Output: new ProviderOutput(".epub", "application/epub+zip", "EPUB"));

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(new AcquisitionRequest("gutenberg", "empty-parts"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be(AcquisitionException.NoAssets);
        result.ErrorCode.Should().Be("provider_no_downloadable_assets");

        // Staging directory cleaned up
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    [Fact]
    public async Task Validation_TooManyParts_ReturnsDownloadTooManyParts()
    {
        using var h = AcquisitionHarness.Create();

        // Provider policy allows at most 2 parts
        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg", maxParts: 2);
        fakeProvider.PlanResult = new ProviderAcquisitionPlan(
            ProviderId: "gutenberg",
            ExternalId: "too-many-parts",
            Asset: new ProviderAsset("asset-1", ProviderMediaKind.Ebook, "Asset", "epub"),
            Metadata: new ProviderMetadata("Book Title"),
            Parts: new[]
            {
                new ProviderDownloadPart(new Uri("https://example.com/1.epub"), ".epub", 100),
                new ProviderDownloadPart(new Uri("https://example.com/2.epub"), ".epub", 100),
                new ProviderDownloadPart(new Uri("https://example.com/3.epub"), ".epub", 100),
            },
            Output: new ProviderOutput(".epub", "application/epub+zip", "EPUB"));

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(new AcquisitionRequest("gutenberg", "too-many-parts"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be(AcquisitionException.TooManyParts);
        result.ErrorCode.Should().Be("download_too_many_parts");

        // Staging directory cleaned up
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    [Fact]
    public async Task Cleanup_OnAnyFailingAcquisition_StagingRootContainsNoDirectoriesAfterwards()
    {
        using var h = AcquisitionHarness.Create();

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        fakeProvider.PlanResult = CreateEbookPlan(
            providerId: "gutenberg",
            externalId: "fail-cleanup",
            assetId: "epub-main",
            title: "Cleanup Test Book");

        h.Downloader.ExceptionToThrowOnDownload = new ProviderDownloadException(
            ProviderDownloadException.Failed, "Network connection dropped.");

        var registry = new ProviderRegistry(new[] { fakeProvider });
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(new AcquisitionRequest("gutenberg", "fail-cleanup"), null, CancellationToken.None);
        result.Outcome.Should().Be(AcquisitionOutcome.Failed);

        // Staging root must be completely empty
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    [Fact]
    public async Task UnknownProvider_FailsWithProviderUnknown_AndTouchesNothing()
    {
        using var h = AcquisitionHarness.Create();

        var registry = new ProviderRegistry(Array.Empty<IContentProvider>());
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(
            new AcquisitionRequest("nobody", "1"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be(AcquisitionException.ProviderUnknown);
        h.Downloader.DownloadCallCount.Should().Be(0);
        Directory.GetDirectories(h.WorkingRootDir).Should().BeEmpty();
    }

    [Fact]
    public async Task ProviderWithoutAcquisitionCapability_FailsWithProviderCannotAcquire()
    {
        using var h = AcquisitionHarness.Create();

        var registry = new ProviderRegistry(new[] { new SearchOnlyProvider() });
        var service = h.CreateService(registry);

        var result = await service.AcquireAsync(
            new AcquisitionRequest("search-only", "1"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Failed);
        result.ErrorCode.Should().Be(AcquisitionException.ProviderCannotAcquire);
        h.Downloader.DownloadCallCount.Should().Be(0);
    }

    /// <summary>
    /// Identity matching is deliberately type-blind, so acquiring an ebook can
    /// "match" a physical row on the shelf that shares title and author.
    /// Attaching an EPUB to it would be a modelling error, so the pipeline must
    /// create a proper ebook edition in the same work instead — and leave the
    /// physical book exactly as it was.
    /// </summary>
    [Fact]
    public async Task CrossTypeMatch_CreatesAnEditionOfTheSameWork_InsteadOfAttachingToThePhysicalBook()
    {
        using var h = AcquisitionHarness.Create();

        var physical = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(
                "client", $"create-{Guid.NewGuid():N}", "physical", "The Republic", Author: "Plato"),
            strictConfirmation: false);
        var physicalId = ((LibraryCreateOrMatchResultDto)physical.Data!).BookId!.Value;

        var fakeProvider = new FakeContentProvider("gutenberg", "Project Gutenberg");
        fakeProvider.PlanResult = CreateEbookPlan(
            providerId: "gutenberg",
            externalId: "1497",
            assetId: "epub3-images",
            title: "The Republic",
            author: "Plato");

        var service = h.CreateService(new ProviderRegistry(new[] { fakeProvider }));

        var result = await service.AcquireAsync(
            new AcquisitionRequest("gutenberg", "1497", "epub3-images"), null, CancellationToken.None);

        result.Outcome.Should().Be(AcquisitionOutcome.Acquired);
        result.BookId.Should().NotBe(physicalId, "an ebook must not be attached to a physical book row");
        result.Book!.Type.Should().Be("ebook");

        // The physical book is untouched: no file, no provenance.
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var physicalBook = await db.Books.SingleAsync(b => b.Id == physicalId);
        physicalBook.FileDetails.HasFile.Should().BeFalse();
        (await db.BookAcquisitions.CountAsync(a => a.BookId == physicalId)).Should().Be(0);

        // ...and the new edition is grouped with it, so the library still shows
        // one work rather than two.
        var acquired = await h.Library.GetBookAsync(result.BookId!.Value);
        var acquiredDto = (BookDto)acquired.Data!;
        acquiredDto.WorkId.Should().Be(physicalBook.WorkId);
    }

    /// <summary>A provider that can only search: used to prove the acquisition
    /// surface refuses a source that cannot actually deliver anything.</summary>
    private sealed class SearchOnlyProvider : IContentProvider, IProviderSearch
    {
        public string Id => "search-only";

        public string DisplayName => "Search Only";

        public ProviderCapabilities Capabilities => ProviderCapabilities.Search;

        public string? RightsNotice => null;

        public Task<ProviderSearchPage> SearchAsync(ProviderSearchQuery query, CancellationToken ct = default) =>
            Task.FromResult(new ProviderSearchPage([]));
    }
}
