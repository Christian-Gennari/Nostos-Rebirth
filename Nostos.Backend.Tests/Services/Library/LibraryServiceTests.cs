using System.Net.Http;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Tests.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Services.Library;

public sealed class LibraryServiceTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private const string Client = "test-client";
    private const string IsbnBorges = "9780141183848";
    private const string AsinExample = "B095TNRPXD";

    private readonly ReadingTrainingSqliteFixture _fixture;

    public LibraryServiceTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    // ------------------------------------------------------------------
    // Create-or-match
    // ------------------------------------------------------------------

    [Fact]
    public async Task Create_book_with_isbn_creates_and_normalizes_identity()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(CreateRequest("physical", "Fictions", Isbn: IsbnBorges), strictConfirmation: true);

        result.Duplicate.Should().BeFalse();
        result.StateVersion.Should().Be("1");
        var data = (LibraryCreateOrMatchResultDto)result.Data!;
        data.Outcome.Should().Be("created");
        data.BookId.Should().NotBeNull();

        await using var db = await h.Factory.CreateDbContextAsync();
        var book = await db.PhysicalBooks.SingleAsync(b => b.Id == data.BookId);
        book.NormalizedIsbn.Should().Be(IsbnBorges);
        book.NormalizedAsin.Should().BeNull();
        (await db.LibraryCommandReceipts.CountAsync()).Should().Be(1);
        (await db.LibraryStates.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Create_with_same_isbn_different_key_matches_existing()
    {
        var h = Harness();
        var first = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Isbn: IsbnBorges), strictConfirmation: true);
        var second = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions (different title)", Isbn: IsbnBorges), strictConfirmation: true);

        second.Duplicate.Should().BeFalse();
        var data = (LibraryCreateOrMatchResultDto)second.Data!;
        data.Outcome.Should().Be("matched");
        data.BookId.Should().Be(((LibraryCreateOrMatchResultDto)first.Data!).BookId);
        second.StateVersion.Should().Be("1", "matching does not bump the version");

        await using var db = await h.Factory.CreateDbContextAsync();
        (await db.Books.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Create_audiobook_with_asin_sets_normalized_asin_only()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("audiobook", "War and Peace", Asin: AsinExample, Isbn: IsbnBorges),
            strictConfirmation: true);

        var data = (LibraryCreateOrMatchResultDto)result.Data!;
        await using var db = await h.Factory.CreateDbContextAsync();
        var book = await db.AudioBooks.SingleAsync(b => b.Id == data.BookId);
        book.NormalizedAsin.Should().Be(AsinExample);
        book.NormalizedIsbn.Should().BeNull("an audiobook does not carry ISBN identity");
    }

    [Fact]
    public async Task Create_matches_exact_title_and_author()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Jorge Luis Borges"), strictConfirmation: true);
        var second = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "fictions", Author: "jorge luis borges"), strictConfirmation: true);

        var data = (LibraryCreateOrMatchResultDto)second.Data!;
        data.Outcome.Should().Be("matched");
        second.StateVersion.Should().Be("1");
    }

    [Fact]
    public async Task Create_multiple_title_author_matches_strict_requires_confirmation()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Meditations", Author: "Marcus Aurelius"), strictConfirmation: true);

        // Seed a second same-title/author edition directly (the service would
        // otherwise match it instead of creating a duplicate).
        await using (var db = await h.Factory.CreateDbContextAsync())
        {
            db.PhysicalBooks.Add(new PhysicalBookModel
            {
                Title = "Meditations",
                Author = "Marcus Aurelius",
                Metadata = { Edition = "Different edition" },
            });
            await db.SaveChangesAsync();
        }

        var strict = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Meditations", Author: "Marcus Aurelius"), strictConfirmation: true);

        strict.Duplicate.Should().BeFalse();
        var err = (LibraryConfirmationErrorDto)strict.Data!;
        err.Code.Should().Be("confirmation_required");
        err.Candidates.Should().HaveCount(2);
        strict.StateVersion.Should().Be("1", "no state change from a rejected command");

        var permissive = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Meditations", Author: "Marcus Aurelius"), strictConfirmation: false);
        ((LibraryCreateOrMatchResultDto)permissive.Data!).Outcome.Should().Be("created");

        await using var db2 = await h.Factory.CreateDbContextAsync();
        (await db2.Books.CountAsync()).Should().Be(3);
    }

    [Fact]
    public async Task Create_title_only_strict_with_fuzzy_candidates_requires_confirmation()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "The Republic", Author: "Plato"), strictConfirmation: true);

        var strict = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "republic"), strictConfirmation: true);

        var err = (LibraryConfirmationErrorDto)strict.Data!;
        err.Code.Should().Be("confirmation_required");
        err.Candidates.Should().HaveCount(1);
        err.Candidates[0].MatchReason.Should().Be("fuzzy title match");
    }

    [Fact]
    public async Task Create_bare_title_strict_without_candidates_requires_more_information()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Some Unknown Book"), strictConfirmation: true);

        ((LibraryErrorDto)result.Data!).Code.Should().Be("confirmation_required");
        (await CountBooksAsync(h)).Should().Be(0);
    }

    [Fact]
    public async Task Create_bare_title_non_strict_creates()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Some Unknown Book"), strictConfirmation: false);

        ((LibraryCreateOrMatchResultDto)result.Data!).Outcome.Should().Be("created");
        (await CountBooksAsync(h)).Should().Be(1);
    }

    [Fact]
    public async Task Create_identity_conflict_when_isbn_and_asin_resolve_to_different_books()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Book A", Isbn: "9780141183848"), strictConfirmation: true);
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("audiobook", "Book B", Asin: AsinExample), strictConfirmation: true);

        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Book C", Isbn: "9780141183848", Asin: AsinExample),
            strictConfirmation: true);

        ((LibraryErrorDto)result.Data!).Code.Should().Be("identity_conflict");
    }

    [Fact]
    public async Task ForceCreate_creates_despite_fuzzy_candidates()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "The Republic", Author: "Plato"), strictConfirmation: true);

        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "republic", ForceCreate: true), strictConfirmation: true);

        ((LibraryCreateOrMatchResultDto)result.Data!).Outcome.Should().Be("created");
        (await CountBooksAsync(h)).Should().Be(2);
    }

    [Fact]
    public async Task ConfirmedBookId_returns_that_book()
    {
        var h = Harness();
        var created = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges"), strictConfirmation: true);
        var createdId = ((LibraryCreateOrMatchResultDto)created.Data!).BookId!.Value;

        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Totally Different Title", ConfirmedBookId: createdId),
            strictConfirmation: true);

        var data = (LibraryCreateOrMatchResultDto)result.Data!;
        data.Outcome.Should().Be("matched");
        data.BookId.Should().Be(createdId);
        data.Book!.Title.Should().Be("Fictions");
    }

    [Fact]
    public async Task ConfirmedBookId_missing_returns_book_not_found()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "X", ConfirmedBookId: Guid.NewGuid()), strictConfirmation: true);

        ((LibraryErrorDto)result.Data!).Code.Should().Be("book_not_found");
    }

    [Fact]
    public async Task Create_with_missing_collection_returns_collection_not_found()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges", CollectionId: Guid.NewGuid()),
            strictConfirmation: true);

        ((LibraryErrorDto)result.Data!).Code.Should().Be("collection_not_found");
    }

    [Fact]
    public async Task Create_with_existing_collection_places_book()
    {
        var h = Harness();
        var collection = await h.Service.CreateCollectionAsync(new(Client, "coll-1", "Philosophy"));
        var collectionId = ((CollectionDto)collection.Data!).Id;

        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges", CollectionId: collectionId),
            strictConfirmation: true);

        var bookId = ((LibraryCreateOrMatchResultDto)result.Data!).BookId!.Value;
        await using var db = await h.Factory.CreateDbContextAsync();
        (await db.Books.SingleAsync(b => b.Id == bookId)).CollectionId.Should().Be(collectionId);
    }

    [Fact]
    public async Task Create_blank_title_returns_invalid_book_identity()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "   "), strictConfirmation: true);

        ((LibraryErrorDto)result.Data!).Code.Should().Be("invalid_book_identity");
    }

    [Fact]
    public async Task Same_key_replay_returns_duplicate_without_recreating()
    {
        var h = Harness();
        var first = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Isbn: IsbnBorges, Key: "key-1"), strictConfirmation: true);
        var replay = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Isbn: IsbnBorges, Key: "key-1"), strictConfirmation: true);

        replay.Duplicate.Should().BeTrue();
        replay.Reply.Should().Be(first.Reply);
        replay.StateVersion.Should().Be(first.StateVersion);

        await using var db = await h.Factory.CreateDbContextAsync();
        (await db.Books.CountAsync()).Should().Be(1);
        (await db.LibraryCommandReceipts.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Concurrent_same_key_produces_one_row_and_one_receipt()
    {
        var h = Harness();
        var tasks = Enumerable.Range(0, 4).Select(_ =>
            h.Service.CreateOrMatchBookAsync(
                CreateRequest("physical", "Fictions", Isbn: IsbnBorges, Key: "key-race"), strictConfirmation: true));
        var results = await Task.WhenAll(tasks);

        results.Count(r => r.Duplicate).Should().Be(3, "the gate serializes; later callers replay the stored receipt");
        await using var db = await h.Factory.CreateDbContextAsync();
        (await db.Books.CountAsync()).Should().Be(1);
        (await db.LibraryCommandReceipts.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Invalid_idempotency_pair_is_rejected()
    {
        var h = Harness();
        var result = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Key: ""), strictConfirmation: true);

        ((LibraryErrorDto)result.Data!).Code.Should().Be("invalid_idempotency");
    }

    [Fact]
    public async Task Version_bumps_on_change_and_stays_stable_on_reads_and_matches()
    {
        var h = Harness();
        var create = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Isbn: IsbnBorges), strictConfirmation: true);
        create.StateVersion.Should().Be("1");

        var list = await h.Service.ListBooksAsync(BookFilter.All, BookSort.Recent, null, 1, 20, null);
        list.StateVersion.Should().Be("1");

        var match = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Isbn: IsbnBorges), strictConfirmation: true);
        match.StateVersion.Should().Be("1");

        var update = await h.Service.UpdateBookAsync(new(Client, "upd-1",
            ((LibraryCreateOrMatchResultDto)create.Data!).BookId!.Value, Author: "Borges"));
        update.StateVersion.Should().Be("2");
    }

    // ------------------------------------------------------------------
    // Update
    // ------------------------------------------------------------------

    [Fact]
    public async Task Update_applies_null_preserving_semantics_and_clears_with_empty_string()
    {
        var h = Harness();
        var created = await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges", Subtitle: "Sub"), strictConfirmation: true);
        var bookId = ((LibraryCreateOrMatchResultDto)created.Data!).BookId!.Value;

        var updated = await h.Service.UpdateBookAsync(new(Client, "upd-1", bookId, Author: "J.L. Borges", Subtitle: ""));
        var data = (BookDto)updated.Data!;
        data.Author.Should().Be("J.L. Borges");
        data.Subtitle.Should().BeNull();
        data.Title.Should().Be("Fictions", "unset fields are untouched");
    }

    [Fact]
    public async Task Update_moves_and_clears_collection()
    {
        var h = Harness();
        var coll1 = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "c1", "Philosophy"))).Data!;
        var coll2 = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "c2", "Fiction"))).Data!;
        var bookId = ((LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges"), strictConfirmation: true)).Data!).BookId!.Value;

        await h.Service.UpdateBookAsync(new(Client, "u1", bookId, CollectionId: coll1.Id));
        (await GetBookAsync(h, bookId)).CollectionId.Should().Be(coll1.Id);

        await h.Service.UpdateBookAsync(new(Client, "u2", bookId, CollectionId: coll2.Id));
        (await GetBookAsync(h, bookId)).CollectionId.Should().Be(coll2.Id);

        await h.Service.UpdateBookAsync(new(Client, "u3", bookId, ClearCollection: true));
        (await GetBookAsync(h, bookId)).CollectionId.Should().BeNull();
    }

    [Fact]
    public async Task Update_isbn_recomputes_normalized_identity()
    {
        var h = Harness();
        var bookId = ((LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges"), strictConfirmation: true)).Data!).BookId!.Value;

        await h.Service.UpdateBookAsync(new(Client, "u1", bookId, Isbn: IsbnBorges));

        await using var db = await h.Factory.CreateDbContextAsync();
        var book = await db.PhysicalBooks.SingleAsync(b => b.Id == bookId);
        book.NormalizedIsbn.Should().Be(IsbnBorges);
    }

    [Fact]
    public async Task Update_isbn_conflicting_with_another_book_returns_duplicate_identifier()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Book A", Isbn: IsbnBorges), strictConfirmation: true);
        var b = ((LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Book B", Author: "Author B"), strictConfirmation: true)).Data!).BookId!.Value;

        var result = await h.Service.UpdateBookAsync(new(Client, "u1", b, Isbn: IsbnBorges));

        ((LibraryErrorDto)result.Data!).Code.Should().Be("duplicate_identifier");
    }

    [Fact]
    public async Task Update_missing_book_returns_book_not_found()
    {
        var h = Harness();
        var result = await h.Service.UpdateBookAsync(new(Client, "u1", Guid.NewGuid(), Title: "X"));
        ((LibraryErrorDto)result.Data!).Code.Should().Be("book_not_found");
    }

    [Fact]
    public async Task Update_blank_title_is_rejected()
    {
        var h = Harness();
        var bookId = ((LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges"), strictConfirmation: true)).Data!).BookId!.Value;

        var result = await h.Service.UpdateBookAsync(new(Client, "u1", bookId, Title: " "));
        ((LibraryErrorDto)result.Data!).Code.Should().Be("invalid_book_identity");
    }

    // ------------------------------------------------------------------
    // Collections
    // ------------------------------------------------------------------

    [Fact]
    public async Task Create_collection_and_replay_same_key()
    {
        var h = Harness();
        var created = await h.Service.CreateCollectionAsync(new(Client, "k1", "Philosophy"));
        created.StateVersion.Should().Be("1");
        ((CollectionDto)created.Data!).Name.Should().Be("Philosophy");

        var replay = await h.Service.CreateCollectionAsync(new(Client, "k1", "Philosophy"));
        replay.Duplicate.Should().BeTrue();
    }

    [Fact]
    public async Task Create_duplicate_sibling_returns_existing_collection()
    {
        var h = Harness();
        var first = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "k1", "Philosophy"))).Data!;
        var second = await h.Service.CreateCollectionAsync(new(Client, "k2", "  philosophy "));

        second.Reply.Should().Be(LibraryReplyFormatter.CollectionExists("Philosophy"));
        ((CollectionDto)second.Data!).Id.Should().Be(first.Id);
        second.StateVersion.Should().Be("1", "no change when returning the existing collection");

        // Same name under a different parent is a different collection.
        var root = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "k3", "Root"))).Data!;
        var child = await h.Service.CreateCollectionAsync(new(Client, "k4", "Philosophy", ParentId: root.Id));
        ((CollectionDto)child.Data!).Id.Should().NotBe(first.Id);
    }

    [Fact]
    public async Task Create_collection_missing_parent_and_blank_name()
    {
        var h = Harness();
        var missingParent = await h.Service.CreateCollectionAsync(new(Client, "k1", "X", ParentId: Guid.NewGuid()));
        ((LibraryErrorDto)missingParent.Data!).Code.Should().Be("invalid_collection_parent");

        var blank = await h.Service.CreateCollectionAsync(new(Client, "k2", "  "));
        ((LibraryErrorDto)blank.Data!).Code.Should().Be("invalid_collection_name");
    }

    [Fact]
    public async Task Rename_collection_and_detect_sibling_collision()
    {
        var h = Harness();
        var a = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "k1", "Alpha"))).Data!;
        await h.Service.CreateCollectionAsync(new(Client, "k2", "Beta"));

        var renamed = await h.Service.RenameCollectionAsync(new(Client, "k3", a.Id, "Gamma"));
        ((CollectionDto)renamed.Data!).Name.Should().Be("Gamma");

        var collision = await h.Service.RenameCollectionAsync(new(Client, "k4", a.Id, "BETA"));
        ((LibraryErrorDto)collision.Data!).Code.Should().Be("collection_name_conflict");
    }

    [Fact]
    public async Task Move_collection_cycle_detection_and_root_move()
    {
        var h = Harness();
        var root = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "k1", "Root"))).Data!;
        var child = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "k2", "Child", ParentId: root.Id))).Data!;

        // Self-parent.
        var self = await h.Service.MoveCollectionAsync(new(Client, "k3", root.Id, NewParentId: root.Id));
        ((LibraryErrorDto)self.Data!).Code.Should().Be("collection_cycle");

        // Move root under its own child.
        var cycle = await h.Service.MoveCollectionAsync(new(Client, "k4", root.Id, NewParentId: child.Id));
        ((LibraryErrorDto)cycle.Data!).Code.Should().Be("collection_cycle");

        // Move child to root (null parent).
        var moved = await h.Service.MoveCollectionAsync(new(Client, "k5", child.Id, NewParentId: null));
        ((CollectionDto)moved.Data!).ParentId.Should().BeNull();

        // Missing parent.
        var missing = await h.Service.MoveCollectionAsync(new(Client, "k6", child.Id, NewParentId: Guid.NewGuid()));
        ((LibraryErrorDto)missing.Data!).Code.Should().Be("invalid_collection_parent");
    }

    [Fact]
    public async Task Delete_collection_requires_confirmation_rejects_children_and_unlinks_books()
    {
        var h = Harness();
        var parent = (CollectionDto)(await h.Service.CreateCollectionAsync(new(Client, "k1", "Parent"))).Data!;
        var bookId = ((LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges", CollectionId: parent.Id),
            strictConfirmation: true)).Data!).BookId!.Value;

        // Without confirmation.
        var noConfirm = await h.Service.DeleteCollectionAsync(new(Client, "k2", parent.Id));
        ((LibraryErrorDto)noConfirm.Data!).Code.Should().Be("confirmation_required");

        // With children.
        await h.Service.CreateCollectionAsync(new(Client, "k3", "Child", ParentId: parent.Id));
        var hasChildren = await h.Service.DeleteCollectionAsync(new(Client, "k4", parent.Id, Confirm: true));
        ((LibraryErrorDto)hasChildren.Data!).Code.Should().Be("collection_has_children");

        // Remove the child, then delete: books unlinked, not deleted.
        await using (var db = await h.Factory.CreateDbContextAsync())
        {
            var child = await db.Collections.SingleAsync(c => c.Name == "Child");
            db.Collections.Remove(child);
            await db.SaveChangesAsync();
        }

        var deleted = await h.Service.DeleteCollectionAsync(new(Client, "k5", parent.Id, Confirm: true));
        var outcome = (LibraryDeleteCollectionResultDto)deleted.Data!;
        outcome.BooksUnlinked.Should().Be(1);
        outcome.ChildrenAffected.Should().Be(0);

        (await GetBookAsync(h, bookId)).CollectionId.Should().BeNull();
        (await CountCollectionsAsync(h)).Should().Be(0);
    }

    // ------------------------------------------------------------------
    // Resolve (read-only)
    // ------------------------------------------------------------------

    [Fact]
    public async Task Resolve_exact_isbn_matches()
    {
        var h = Harness();
        var created = (LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Isbn: IsbnBorges), strictConfirmation: true)).Data!;

        var result = await h.Service.ResolveBookAsync(new LibraryResolveBookRequest(Isbn: "978-0-141-18384-8"));

        result.Resolution.Should().Be(LibraryResolution.ExactMatch);
        result.MatchedBook!.Id.Should().Be(created.BookId!.Value);
    }

    [Fact]
    public async Task Resolve_identity_conflict()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "A", Isbn: IsbnBorges), strictConfirmation: true);
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("audiobook", "B", Asin: AsinExample), strictConfirmation: true);

        var result = await h.Service.ResolveBookAsync(new LibraryResolveBookRequest(Isbn: IsbnBorges, Asin: AsinExample));
        result.Resolution.Should().Be(LibraryResolution.IdentityConflict);
    }

    [Fact]
    public async Task Resolve_title_author_and_fuzzy_candidates()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "The Republic", Author: "Plato"), strictConfirmation: true);
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Republic of Silence", Author: "Hanna"), strictConfirmation: true);

        var exact = await h.Service.ResolveBookAsync(new LibraryResolveBookRequest(Title: "the republic", Author: "plato"));
        exact.Resolution.Should().Be(LibraryResolution.ExactMatch);

        var fuzzy = await h.Service.ResolveBookAsync(new LibraryResolveBookRequest(Title: "republic"));
        fuzzy.Resolution.Should().Be(LibraryResolution.Candidates);
        fuzzy.Candidates.Should().HaveCount(2);
        fuzzy.Candidates.Should().OnlyContain(c => c.MatchReason == "fuzzy title/author match");
    }

    [Fact]
    public async Task Resolve_not_found_without_external_prefill()
    {
        var h = Harness();
        var result = await h.Service.ResolveBookAsync(new LibraryResolveBookRequest(Isbn: "9780141183848", IncludeExternalMetadata: false));

        result.Resolution.Should().Be(LibraryResolution.NotFound);
        result.Prefill.Should().BeNull();
        result.MatchedBook.Should().BeNull();
    }

    // ------------------------------------------------------------------
    // Identity backfill
    // ------------------------------------------------------------------

    [Fact]
    public async Task Backfill_normalizes_legacy_rows_idempotently()
    {
        var h = Harness();
        await using (var db = await h.Factory.CreateDbContextAsync())
        {
            db.PhysicalBooks.Add(new PhysicalBookModel
            {
                Title = "Legacy Physical",
                Author = "A",
                Isbn = "978-0-141-18384-8",
            });
            db.AudioBooks.Add(new AudioBookModel
            {
                Title = "Legacy Audio",
                Author = "B",
                Asin = "b095tnrpxd",
            });
            db.PhysicalBooks.Add(new PhysicalBookModel
            {
                Title = "Legacy Invalid",
                Author = "C",
                Isbn = "not-an-isbn",
            });
            await db.SaveChangesAsync();
        }

        await using (var db = await h.Factory.CreateDbContextAsync())
        {
            await LibraryIdentityBackfill.BackfillAsync(db);
        }

        await using (var verify = await h.Factory.CreateDbContextAsync())
        {
            var physical = await verify.PhysicalBooks.SingleAsync(b => b.Title == "Legacy Physical");
            physical.NormalizedIsbn.Should().Be("9780141183848");

            var audio = await verify.AudioBooks.SingleAsync(b => b.Title == "Legacy Audio");
            audio.NormalizedAsin.Should().Be("B095TNRPXD");
            audio.NormalizedIsbn.Should().BeNull();

            var invalid = await verify.PhysicalBooks.SingleAsync(b => b.Title == "Legacy Invalid");
            invalid.NormalizedIsbn.Should().BeNull();
        }

        // Idempotent: second run changes nothing and does not throw.
        await using (var db = await h.Factory.CreateDbContextAsync())
        {
            await LibraryIdentityBackfill.BackfillAsync(db);
        }
    }

    // ------------------------------------------------------------------
    // List / Get
    // ------------------------------------------------------------------

    [Fact]
    public async Task List_books_validates_pagination_and_honors_search_and_filter()
    {
        var h = Harness();
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Fictions", Author: "Borges"), strictConfirmation: true);
        await h.Service.CreateOrMatchBookAsync(
            CreateRequest("physical", "Truth and Method", Author: "Gadamer"), strictConfirmation: true);
        await h.Service.UpdateBookAsync(new(Client, "fav-1",
            (Guid)((LibraryCreateOrMatchResultDto)(await h.Service.CreateOrMatchBookAsync(
                CreateRequest("physical", "Meditations", Author: "Marcus Aurelius"), strictConfirmation: true)).Data!).BookId!,
            IsFavorite: true));

        var clamped = await h.Service.ListBooksAsync(BookFilter.All, BookSort.Recent, null, 0, 5000, null);
        var page = (PaginatedResponse<BookDto>)clamped.Data!;
        page.Page.Should().Be(1);
        page.PageSize.Should().Be(100);

        var search = (PaginatedResponse<BookDto>)(await h.Service.ListBooksAsync(
            BookFilter.All, BookSort.Recent, "borges", 1, 20, null)).Data!;
        search.TotalCount.Should().Be(1);
        search.Items.Single().Title.Should().Be("Fictions");

        var favorites = (PaginatedResponse<BookDto>)(await h.Service.ListBooksAsync(
            BookFilter.Favorites, BookSort.Recent, null, 1, 20, null)).Data!;
        favorites.TotalCount.Should().Be(1);
    }

    [Fact]
    public async Task Get_book_and_get_collection_not_found_envelopes()
    {
        var h = Harness();
        var book = await h.Service.GetBookAsync(Guid.NewGuid());
        ((LibraryErrorDto)book.Data!).Code.Should().Be("book_not_found");

        var collection = await h.Service.GetCollectionAsync(Guid.NewGuid());
        ((LibraryErrorDto)collection.Data!).Code.Should().Be("collection_not_found");
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private static LibraryCreateBookRequest CreateRequest(
        string type,
        string title,
        string? Author = null,
        string? Subtitle = null,
        string? Isbn = null,
        string? Asin = null,
        Guid? CollectionId = null,
        Guid? ConfirmedBookId = null,
        bool ForceCreate = false,
        string? Key = null) =>
        new(Client, Key ?? $"k-{Guid.NewGuid():N}", type, title,
            Subtitle: Subtitle,
            Author: Author,
            Isbn: Isbn,
            Asin: Asin,
            CollectionId: CollectionId,
            ConfirmedBookId: ConfirmedBookId,
            ForceCreate: ForceCreate);

    private async Task<int> CountBooksAsync(TestHarness h)
    {
        await using var db = await h.Factory.CreateDbContextAsync();
        return await db.Books.CountAsync();
    }

    private async Task<int> CountCollectionsAsync(TestHarness h)
    {
        await using var db = await h.Factory.CreateDbContextAsync();
        return await db.Collections.CountAsync();
    }

    private async Task<BookDto> GetBookAsync(TestHarness h, Guid id)
    {
        var result = await h.Service.GetBookAsync(id);
        return (BookDto)result.Data!;
    }

    private TestHarness Harness()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;
        using (var bootstrap = new NostosDbContext(options))
        {
            bootstrap.Database.EnsureCreated();
        }

        var factory = new TestContextFactory(options);
        var lookup = new BookLookupService(new NoopHttpClientFactory(), new SilentLogger<BookLookupService>());
        var service = new LibraryService(factory, lookup);
        return new TestHarness(factory, service);
    }

    private sealed record TestHarness(IDbContextFactory<NostosDbContext> Factory, ILibraryService Service);

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class NoopHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    private sealed class SilentLogger<T> : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => false;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
        }
    }
}
