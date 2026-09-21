using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Services.Library;

public sealed class AttachAcquiredAssetTests
{
    private const string Client = "test-client";

    [Fact]
    public async Task AttachAcquiredAsset_DirectMutation_SetsFileDetailsAndInsertsBookAcquisitionRow()
    {
        using var h = AcquisitionHarness.Create();

        // 1. Create a book first
        var createResult = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(
                ClientId: Client,
                IdempotencyKey: $"create-{Guid.NewGuid():N}",
                Type: "ebook",
                Title: "The Metamorphosis",
                Author: "Franz Kafka"),
            strictConfirmation: false);

        var outcome = (LibraryCreateOrMatchResultDto)createResult.Data!;
        var bookId = outcome.BookId!.Value;

        // 2. Attach acquired asset directly
        var attachRequest = new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "book.epub",
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "5200",
            AssetId: "epub3",
            AssetFormat: "epub3-images",
            SourceUrl: "https://gutenberg.org/ebooks/5200",
            RightsStatement: "Public domain in the USA",
            AcquiredAt: DateTime.UtcNow);

        var attachResult = await h.Library.AttachAcquiredAssetAsync(attachRequest);

        attachResult.Duplicate.Should().BeFalse();
        var attachDto = (LibraryAttachAcquiredAssetResultDto)attachResult.Data!;
        attachDto.BookId.Should().Be(bookId);
        attachDto.Book.Should().NotBeNull();
        attachDto.Book!.HasFile.Should().BeTrue();
        attachDto.Book.FileName.Should().Be("book.epub");

        // Verify database state
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var bookInDb = await db.Books
            .Include(b => b.Acquisition)
            .SingleAsync(b => b.Id == bookId);

        bookInDb.FileDetails.HasFile.Should().BeTrue();
        bookInDb.FileDetails.FileName.Should().Be("book.epub");
        bookInDb.Acquisition.Should().NotBeNull();
        bookInDb.Acquisition!.ProviderId.Should().Be("gutenberg");
        bookInDb.Acquisition.ProviderDisplayName.Should().Be("Project Gutenberg");
        bookInDb.Acquisition.ExternalId.Should().Be("5200");
        bookInDb.Acquisition.AssetId.Should().Be("epub3");
        bookInDb.Acquisition.AssetFormat.Should().Be("epub3-images");
        bookInDb.Acquisition.RightsStatement.Should().Be("Public domain in the USA");
    }

    [Fact]
    public async Task AttachAcquiredAsset_SameAssetOnSameBook_IsSuccessfulNoOp_AndDoesNotAddSecondRow()
    {
        using var h = AcquisitionHarness.Create();

        var createResult = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(
                ClientId: Client,
                IdempotencyKey: $"create-{Guid.NewGuid():N}",
                Type: "ebook",
                Title: "The Trial",
                Author: "Franz Kafka"),
            strictConfirmation: false);

        var bookId = ((LibraryCreateOrMatchResultDto)createResult.Data!).BookId!.Value;

        var attachRequest1 = new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-1-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "book.epub",
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "7849",
            AssetId: "epub3");

        var attachResult1 = await h.Library.AttachAcquiredAssetAsync(attachRequest1);
        attachResult1.Data.Should().BeOfType<LibraryAttachAcquiredAssetResultDto>();

        // Call a second time with a different idempotency key for the SAME book and asset
        var attachRequest2 = new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-2-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "book.epub",
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "7849",
            AssetId: "epub3");

        var attachResult2 = await h.Library.AttachAcquiredAssetAsync(attachRequest2);
        attachResult2.Data.Should().BeOfType<LibraryAttachAcquiredAssetResultDto>();
        attachResult2.Reply.Should().Be(LibraryReplyFormatter.AssetAlreadyAttached("The Trial"));

        // Verify only 1 acquisition row exists
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var rows = await db.BookAcquisitions.Where(a => a.BookId == bookId).ToListAsync();
        rows.Should().HaveCount(1);
    }

    [Fact]
    public async Task AttachAcquiredAsset_SameAssetOnDifferentBook_ReturnsAcquisitionConflict()
    {
        using var h = AcquisitionHarness.Create();

        // Create book 1
        var book1Res = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(Client, $"create-1-{Guid.NewGuid():N}", "ebook", "Book One"),
            strictConfirmation: false);
        var book1Id = ((LibraryCreateOrMatchResultDto)book1Res.Data!).BookId!.Value;

        // Create book 2
        var book2Res = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(Client, $"create-2-{Guid.NewGuid():N}", "ebook", "Book Two"),
            strictConfirmation: false);
        var book2Id = ((LibraryCreateOrMatchResultDto)book2Res.Data!).BookId!.Value;

        // Attach to book 1
        var attach1 = await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-1-{Guid.NewGuid():N}",
            BookId: book1Id,
            FileName: "book.epub",
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "1234",
            AssetId: "asset-1"));

        attach1.Data.Should().BeOfType<LibraryAttachAcquiredAssetResultDto>();

        // Attempt to attach the same provider+externalId+assetId to book 2
        var attach2 = await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-2-{Guid.NewGuid():N}",
            BookId: book2Id,
            FileName: "book.epub",
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "1234",
            AssetId: "asset-1"));

        attach2.Data.Should().BeOfType<LibraryErrorDto>();
        var error = (LibraryErrorDto)attach2.Data!;
        error.Code.Should().Be("acquisition_conflict");
        attach2.Reply.Should().Be(LibraryReplyFormatter.AcquisitionConflict);
    }

    [Theory]
    [InlineData("../evil.epub")]
    [InlineData("sub/evil.epub")]
    [InlineData("")]
    public async Task AttachAcquiredAsset_FileNameWithPathSeparatorOrEmpty_IsRejectedWithInvalidFileName(string invalidName)
    {
        using var h = AcquisitionHarness.Create();

        var createResult = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(Client, $"create-{Guid.NewGuid():N}", "ebook", "Some Book"),
            strictConfirmation: false);
        var bookId = ((LibraryCreateOrMatchResultDto)createResult.Data!).BookId!.Value;

        var attachResult = await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: invalidName,
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "1234",
            AssetId: "asset-1"));

        attachResult.Data.Should().BeOfType<LibraryErrorDto>();
        var error = (LibraryErrorDto)attachResult.Data!;
        error.Code.Should().Be("invalid_file_name");
    }

    [Fact]
    public async Task AttachAcquiredAsset_Audiobook_WritesDurationAndChaptersJson()
    {
        using var h = AcquisitionHarness.Create();

        var createResult = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(Client, $"create-{Guid.NewGuid():N}", "audiobook", "Audio Book Title"),
            strictConfirmation: false);
        var bookId = ((LibraryCreateOrMatchResultDto)createResult.Data!).BookId!.Value;

        var chapters = new List<BookChapterDto>
        {
            new("Chapter 1", 0.0),
            new("Chapter 2", 120.5)
        };

        var attachResult = await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "book.m4b",
            ProviderId: "librivox",
            ProviderDisplayName: "LibriVox",
            ExternalId: "audio-42",
            AssetId: "m4b-asset",
            Duration: "05:00:00",
            Chapters: chapters));

        attachResult.Data.Should().BeOfType<LibraryAttachAcquiredAssetResultDto>();

        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var audioBook = await db.Books.OfType<AudioBookModel>().SingleAsync(b => b.Id == bookId);
        audioBook.Duration.Should().Be("05:00:00");
        audioBook.FileDetails.HasFile.Should().BeTrue();
        audioBook.FileDetails.FileName.Should().Be("book.m4b");
        audioBook.FileDetails.ChaptersJson.Should().NotBeNull();
        audioBook.FileDetails.ChaptersJson.Should().Contain("Chapter 1").And.Contain("Chapter 2");
    }

    [Fact]
    public async Task GetBookAsync_ReturnsBookDto_WithSourcePopulated()
    {
        using var h = AcquisitionHarness.Create();

        var createResult = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(Client, $"create-{Guid.NewGuid():N}", "ebook", "Don Quixote", Author: "Cervantes"),
            strictConfirmation: false);
        var bookId = ((LibraryCreateOrMatchResultDto)createResult.Data!).BookId!.Value;

        var acquiredTime = new DateTime(2026, 9, 17, 12, 0, 0, DateTimeKind.Utc);
        await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "book.epub",
            ProviderId: "gutenberg",
            ProviderDisplayName: "Project Gutenberg",
            ExternalId: "999",
            AssetId: "epub-main",
            AssetFormat: "epub3",
            SourceUrl: "https://gutenberg.org/ebooks/999",
            RightsStatement: "Public domain in the USA (Project Gutenberg)",
            AcquiredAt: acquiredTime));

        var getResult = await h.Library.GetBookAsync(bookId);
        getResult.Data.Should().BeOfType<BookDto>();

        var bookDto = (BookDto)getResult.Data!;
        bookDto.Source.Should().NotBeNull();
        bookDto.Source!.ProviderId.Should().Be("gutenberg");
        bookDto.Source.ProviderDisplayName.Should().Be("Project Gutenberg");
        bookDto.Source.ExternalId.Should().Be("999");
        bookDto.Source.AssetFormat.Should().Be("epub3");
        bookDto.Source.SourceUrl.Should().Be("https://gutenberg.org/ebooks/999");
        bookDto.Source.RightsStatement.Should().Be("Public domain in the USA (Project Gutenberg)");
        bookDto.Source.AcquiredAt.Should().Be(acquiredTime);
        bookDto.Status.Should().Be(Nostos.Shared.Enums.BookStatus.Ready);
        bookDto.StatusMessage.Should().BeNull();
    }
}
