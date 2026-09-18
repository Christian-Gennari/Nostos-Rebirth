using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Services.Library;

/// <summary>
/// Hand-made chapters (issue #8). The rule under test is that a list the user typed
/// is authoritative: it is validated, stored, and never overwritten by the file's
/// own metadata — while an update that says nothing about chapters leaves them be.
/// </summary>
public sealed class ManualChaptersTests
{
    private const string Client = "test-client";

    private static LibraryUpdateBookRequest Update(Guid bookId, IReadOnlyList<BookChapterDto>? chapters) =>
        new(
            ClientId: Client,
            IdempotencyKey: $"update-{Guid.NewGuid():N}",
            BookId: bookId,
            Chapters: chapters);

    private static async Task<Guid> CreateAudiobookAsync(AcquisitionHarness h)
    {
        var created = await h.Library.CreateOrMatchBookAsync(
            new LibraryCreateBookRequest(
                ClientId: Client,
                IdempotencyKey: $"create-{Guid.NewGuid():N}",
                Type: "audiobook",
                Title: "The Magic Mountain",
                Author: "Thomas Mann"),
            strictConfirmation: false);

        return ((LibraryCreateOrMatchResultDto)created.Data!).BookId!.Value;
    }

    private static async Task<string?> ChaptersJsonAsync(AcquisitionHarness h, Guid bookId)
    {
        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var book = await db.Books.AsNoTracking().SingleAsync(b => b.Id == bookId);
        return book.FileDetails.ChaptersJson;
    }

    [Fact]
    public async Task Update_with_chapters_stores_them_and_marks_them_hand_made()
    {
        using var h = AcquisitionHarness.Create();
        var bookId = await CreateAudiobookAsync(h);

        var result = await h.Library.UpdateBookAsync(Update(bookId, new[]
        {
            new BookChapterDto("Intro", 0),
            new BookChapterDto("Chapter 1", 330),
        }));

        result.Data.Should().NotBeOfType<LibraryErrorDto>();

        var stored = await ChaptersJsonAsync(h, bookId);
        stored.Should().NotBeNull().And.Contain("Intro").And.Contain("Chapter 1");

        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var book = await db.Books.AsNoTracking().SingleAsync(b => b.Id == bookId);
        book.FileDetails.ChaptersEditedAt.Should().NotBeNull(
            "the stamp is what stops the next metadata pass from overwriting this list");
    }

    [Fact]
    public async Task Update_without_chapters_leaves_them_alone()
    {
        // The regression this guards: the update path treated "no chapters in the
        // request" as "clear them", so editing a title would delete a book's index.
        using var h = AcquisitionHarness.Create();
        var bookId = await CreateAudiobookAsync(h);
        await h.Library.UpdateBookAsync(Update(bookId, new[] { new BookChapterDto("Intro", 0) }));

        var titleOnly = new LibraryUpdateBookRequest(
            ClientId: Client,
            IdempotencyKey: $"renamed-{Guid.NewGuid():N}",
            BookId: bookId,
            Title: "The Magic Mountain (renamed)");

        (await h.Library.UpdateBookAsync(titleOnly)).Data.Should().NotBeOfType<LibraryErrorDto>();

        var stored = await ChaptersJsonAsync(h, bookId);
        stored.Should().NotBeNull().And.Contain("Intro");
    }

    [Fact]
    public async Task Update_with_an_empty_list_clears_them_and_hands_the_book_back_to_metadata()
    {
        using var h = AcquisitionHarness.Create();
        var bookId = await CreateAudiobookAsync(h);
        await h.Library.UpdateBookAsync(Update(bookId, new[] { new BookChapterDto("Intro", 0) }));

        (await h.Library.UpdateBookAsync(Update(bookId, Array.Empty<BookChapterDto>())))
            .Data.Should().NotBeOfType<LibraryErrorDto>();

        (await ChaptersJsonAsync(h, bookId)).Should().BeNull();

        await using var db = await h.ContextFactory.CreateDbContextAsync();
        var book = await db.Books.AsNoTracking().SingleAsync(b => b.Id == bookId);
        book.FileDetails.ChaptersEditedAt.Should().BeNull("clearing the list re-enables metadata");
    }

    [Fact]
    public async Task Update_rejects_a_list_whose_times_do_not_advance()
    {
        using var h = AcquisitionHarness.Create();
        var bookId = await CreateAudiobookAsync(h);

        var result = await h.Library.UpdateBookAsync(Update(bookId, new[]
        {
            new BookChapterDto("One", 0),
            new BookChapterDto("Two", 0),
        }));

        ((LibraryErrorDto)result.Data!).Code.Should().Be("invalid_chapters");
        // Nothing was written on a rejection.
        (await ChaptersJsonAsync(h, bookId)).Should().BeNull();
    }

    [Fact]
    public async Task Update_rejects_a_nameless_chapter_and_a_negative_time()
    {
        using var h = AcquisitionHarness.Create();
        var bookId = await CreateAudiobookAsync(h);

        var nameless = await h.Library.UpdateBookAsync(Update(bookId, new[] { new BookChapterDto("  ", 0) }));
        ((LibraryErrorDto)nameless.Data!).Code.Should().Be("invalid_chapters");

        var negative = await h.Library.UpdateBookAsync(Update(bookId, new[] { new BookChapterDto("One", -5) }));
        ((LibraryErrorDto)negative.Data!).Code.Should().Be("invalid_chapters");
    }

    [Fact]
    public async Task Attaching_an_asset_without_chapters_does_not_erase_a_hand_made_list()
    {
        // Attaching is the other writer of this column: it used to null the JSON
        // whenever the incoming asset carried no chapters.
        using var h = AcquisitionHarness.Create();
        var bookId = await CreateAudiobookAsync(h);
        await h.Library.UpdateBookAsync(Update(bookId, new[]
        {
            new BookChapterDto("Intro", 0),
            new BookChapterDto("Chapter 1", 330),
        }));

        var attach = await h.Library.AttachAcquiredAssetAsync(new LibraryAttachAcquiredAssetRequest(
            ClientId: Client,
            IdempotencyKey: $"attach-{Guid.NewGuid():N}",
            BookId: bookId,
            FileName: "magic-mountain.m4b",
            ProviderId: "librovox",
            ProviderDisplayName: "LibriVox",
            ExternalId: "12345",
            AssetId: "m4b",
            AssetFormat: "m4b",
            SourceUrl: "https://example.org/12345",
            RightsStatement: "Public domain in the USA",
            AcquiredAt: DateTime.UtcNow));

        attach.Data.Should().NotBeOfType<LibraryErrorDto>();
        var stored = await ChaptersJsonAsync(h, bookId);
        stored.Should().NotBeNull().And.Contain("Chapter 1");
    }
}
