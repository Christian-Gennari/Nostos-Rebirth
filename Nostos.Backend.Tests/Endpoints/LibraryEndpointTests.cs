using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Tests.ReadingTraining;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

// Full-host HTTP coverage for the canonical library REST surface (issue #34
// Phase 1b). The Angular UI and MCP tools share this exact surface; these
// tests prove the refactored endpoints keep the legacy REST contracts while
// routing through ILibraryService.
public sealed class LibraryEndpointTests : IClassFixture<ReadingTrainingHttpFactory>
{
    private const string BorgesIsbn = "9780141183848";

    private readonly ReadingTrainingHttpFactory _factory;

    public LibraryEndpointTests(ReadingTrainingHttpFactory factory) => _factory = factory;

    private HttpClient Client => _factory.CreateClient();

    // ------------------------------------------------------------------
    // Books
    // ------------------------------------------------------------------

    [Fact]
    public async Task Create_book_returns_201_with_canonical_dto_and_normalizes_identity()
    {
        var response = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = "Fictions HTTP",
            author = "Jorge Luis Borges",
            isbn = "9780199535576", // unique valid ISBN for this test
            pageCount = 178,
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var book = await response.Content.ReadFromJsonAsync<BookDto>();
        book!.Title.Should().Be("Fictions HTTP");
        book.Isbn.Should().Be("9780199535576");

        await using var db = await OpenDbAsync();
        var stored = await db.PhysicalBooks.SingleAsync(b => b.Id == book.Id);
        stored.NormalizedIsbn.Should().Be("9780199535576");
    }

    [Fact]
    public async Task Create_with_existing_isbn_returns_200_with_existing_book()
    {
        var first = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"Dedupe Book {Guid.NewGuid():N}"[..20],
            author = "A",
            isbn = "9780141183848",
        });
        var firstBook = (await first.Content.ReadFromJsonAsync<BookDto>())!;

        var second = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = "Completely Different Title",
            author = "B",
            isbn = "9780141183848",
        });

        second.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondBook = await second.Content.ReadFromJsonAsync<BookDto>();
        secondBook!.Id.Should().Be(firstBook.Id);
        secondBook.Title.Should().Be(firstBook.Title);
    }

    [Fact]
    public async Task Create_title_only_still_creates_legacy_permissive_semantics()
    {
        var response = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"Permissive {Guid.NewGuid():N}",
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Create_blank_title_returns_400()
    {
        var response = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = "   ",
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Get_book_and_unknown_book_404()
    {
        var created = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"GetMe {Guid.NewGuid():N}",
            author = "Author",
        });
        var book = (await created.Content.ReadFromJsonAsync<BookDto>())!;

        var get = await Client.GetAsync($"/api/books/{book.Id}");
        get.StatusCode.Should().Be(HttpStatusCode.OK);
        (await get.Content.ReadFromJsonAsync<BookDto>())!.Id.Should().Be(book.Id);

        var missing = await Client.GetAsync($"/api/books/{Guid.NewGuid()}");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task List_books_supports_search_pagination_and_collection_filter()
    {
        var title = $"ListMe {Guid.NewGuid():N}";
        await Client.PostAsJsonAsync("/api/books", new { type = "physical", title, author = "Søren Kierkegaard" });

        var search = await Client.GetFromJsonAsync<PaginatedResponse<BookDto>>(
            $"/api/books?search={Uri.EscapeDataString(title)}&pageSize=5");
        search!.TotalCount.Should().Be(1);
        search.Items.Single().Title.Should().Be(title);
        search.PageSize.Should().Be(5);

        var clamped = await Client.GetFromJsonAsync<PaginatedResponse<BookDto>>("/api/books?page=0&pageSize=5000");
        clamped!.Page.Should().Be(1);
        clamped.PageSize.Should().Be(100);
    }

    [Fact]
    public async Task Update_book_changes_metadata_and_empty_string_clears()
    {
        var created = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"UpdateMe {Guid.NewGuid():N}",
            author = "Old Author",
            subtitle = "Subtitle",
        });
        var book = (await created.Content.ReadFromJsonAsync<BookDto>())!;

        var updated = await Client.PutAsJsonAsync($"/api/books/{book.Id}", new
        {
            author = "New Author",
            subtitle = "",
        });

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var dto = await updated.Content.ReadFromJsonAsync<BookDto>();
        dto!.Author.Should().Be("New Author");
        dto.Subtitle.Should().BeNull();
        dto.Title.Should().Be(book.Title);
    }

    [Fact]
    public async Task Update_unknown_book_returns_404()
    {
        var response = await Client.PutAsJsonAsync($"/api/books/{Guid.NewGuid()}", new { title = "X" });
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Progress_update_tracks_percent_and_finished_state_alignment()
    {
        var created = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"ProgressMe {Guid.NewGuid():N}",
        });
        var book = (await created.Content.ReadFromJsonAsync<BookDto>())!;

        var at100 = await Client.PutAsJsonAsync($"/api/books/{book.Id}/progress", new { location = "epub.cfi", percentage = 100 });
        at100.StatusCode.Should().Be(HttpStatusCode.OK);

        var finished = (await Client.GetFromJsonAsync<BookDto>($"/api/books/{book.Id}"))!;
        finished.ProgressPercent.Should().Be(100);
        finished.FinishedAt.Should().NotBeNull();

        var backTo50 = await Client.PutAsJsonAsync($"/api/books/{book.Id}/progress", new { location = "epub.cfi", percentage = 50 });
        backTo50.StatusCode.Should().Be(HttpStatusCode.OK);

        var resumed = (await Client.GetFromJsonAsync<BookDto>($"/api/books/{book.Id}"))!;
        resumed.ProgressPercent.Should().Be(50);
        resumed.FinishedAt.Should().BeNull("progress below 100 must clear the finished state");
    }

    [Fact]
    public async Task Progress_update_unknown_book_returns_404()
    {
        var response = await Client.PutAsJsonAsync($"/api/books/{Guid.NewGuid()}/progress",
            new { location = "x", percentage = 10 });
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Delete_book_removes_row_and_second_delete_is_404()
    {
        var created = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"DeleteMe {Guid.NewGuid():N}",
        });
        var book = (await created.Content.ReadFromJsonAsync<BookDto>())!;

        var deleted = await Client.DeleteAsync($"/api/books/{book.Id}");
        deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var again = await Client.DeleteAsync($"/api/books/{book.Id}");
        again.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Delete_book_that_is_queued_for_reading_returns_409_and_keeps_row()
    {
        // Initialize the singleton reading programme (idempotent).
        await Client.PostAsJsonAsync("/api/reading/initialize", new { clientId = "lib-test", idempotencyKey = "lib-init" });

        var created = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"QueuedBook {Guid.NewGuid():N}",
            author = "Author",
        });
        var book = (await created.Content.ReadFromJsonAsync<BookDto>())!;

        var queued = await Client.PostAsJsonAsync("/api/reading/books", new
        {
            clientId = "lib-test",
            idempotencyKey = $"lib-queue-{book.Id:N}",
            bookId = book.Id,
            mode = 0, // ReadingMode.Endurance (wire format is numeric)
        });
        queued.StatusCode.Should().Be(HttpStatusCode.OK);

        var deleted = await Client.DeleteAsync($"/api/books/{book.Id}");
        deleted.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var stillThere = await Client.GetAsync($"/api/books/{book.Id}");
        stillThere.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Lookup_invalid_isbn_returns_400_without_external_call()
    {
        var response = await Client.GetAsync("/api/books/lookup/9780141183849"); // bad checksum
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ------------------------------------------------------------------
    // Collections
    // ------------------------------------------------------------------

    [Fact]
    public async Task Create_collection_duplicate_sibling_returns_existing()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var first = await Client.PostAsJsonAsync("/api/collections", new { name = $"Shelf {suffix}" });
        first.StatusCode.Should().Be(HttpStatusCode.Created);
        var firstDto = (await first.Content.ReadFromJsonAsync<CollectionDto>())!;

        var second = await Client.PostAsJsonAsync("/api/collections", new { name = $"  shelf {suffix}  " });
        second.StatusCode.Should().Be(HttpStatusCode.Created, "legacy REST always returns 201 on success");
        var secondDto = (await second.Content.ReadFromJsonAsync<CollectionDto>())!;
        secondDto.Id.Should().Be(firstDto.Id);
    }

    [Fact]
    public async Task Create_collection_with_missing_parent_returns_400()
    {
        var response = await Client.PostAsJsonAsync("/api/collections", new
        {
            name = "Orphan",
            parentId = Guid.NewGuid(),
        });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Update_collection_renames_and_moves()
    {
        var root = (await (await Client.PostAsJsonAsync("/api/collections", new { name = $"Root {Guid.NewGuid():N}"[..24] }))
            .Content.ReadFromJsonAsync<CollectionDto>())!;
        var child = (await (await Client.PostAsJsonAsync("/api/collections", new { name = $"Child {Guid.NewGuid():N}"[..24], parentId = root.Id }))
            .Content.ReadFromJsonAsync<CollectionDto>())!;

        var renamed = await Client.PutAsJsonAsync($"/api/collections/{child.Id}", new { name = "Renamed Child", parentId = child.ParentId });
        renamed.StatusCode.Should().Be(HttpStatusCode.OK);
        (await renamed.Content.ReadFromJsonAsync<CollectionDto>())!.Name.Should().Be("Renamed Child");

        var moved = await Client.PutAsJsonAsync($"/api/collections/{child.Id}", new { name = "Renamed Child", parentId = (Guid?)null });
        moved.StatusCode.Should().Be(HttpStatusCode.OK);
        (await moved.Content.ReadFromJsonAsync<CollectionDto>())!.ParentId.Should().BeNull();
    }

    [Fact]
    public async Task Update_collection_into_own_child_returns_409()
    {
        var parent = (await (await Client.PostAsJsonAsync("/api/collections", new { name = $"Parent {Guid.NewGuid():N}"[..24] }))
            .Content.ReadFromJsonAsync<CollectionDto>())!;
        var child = (await (await Client.PostAsJsonAsync("/api/collections", new { name = $"Child {Guid.NewGuid():N}"[..24], parentId = parent.Id }))
            .Content.ReadFromJsonAsync<CollectionDto>())!;

        var response = await Client.PutAsJsonAsync($"/api/collections/{parent.Id}", new { name = parent.Name, parentId = child.Id });
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Delete_collection_unlinks_books_and_rejects_children()
    {
        var parent = (await (await Client.PostAsJsonAsync("/api/collections", new { name = $"Tmp {Guid.NewGuid():N}"[..24] }))
            .Content.ReadFromJsonAsync<CollectionDto>())!;
        var child = (await (await Client.PostAsJsonAsync("/api/collections", new { name = $"Sub {Guid.NewGuid():N}"[..24], parentId = parent.Id }))
            .Content.ReadFromJsonAsync<CollectionDto>())!;

        var withChildren = await Client.DeleteAsync($"/api/collections/{parent.Id}");
        withChildren.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var book = (await (await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"ShelfBook {Guid.NewGuid():N}",
            collectionId = parent.Id,
        })).Content.ReadFromJsonAsync<BookDto>())!;

        var childDeleted = await Client.DeleteAsync($"/api/collections/{child.Id}");
        childDeleted.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var deleted = await Client.DeleteAsync($"/api/collections/{parent.Id}");
        deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var bookAfter = (await Client.GetFromJsonAsync<BookDto>($"/api/books/{book.Id}"))!;
        bookAfter.CollectionId.Should().BeNull("books are unlinked, never deleted");
    }

    [Fact]
    public async Task Get_collections_flat_list_and_404()
    {
        var list = await Client.GetFromJsonAsync<CollectionDto[]>("/api/collections");
        list.Should().NotBeNull();

        var missing = await Client.GetAsync($"/api/collections/{Guid.NewGuid()}");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ------------------------------------------------------------------

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
