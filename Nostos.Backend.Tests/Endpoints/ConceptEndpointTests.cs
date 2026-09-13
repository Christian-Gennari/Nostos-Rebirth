using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

public sealed class ConceptEndpointTests : IClassFixture<LibraryEndpointFactory>
{
    private readonly LibraryEndpointFactory _factory;

    public ConceptEndpointTests(LibraryEndpointFactory factory) => _factory = factory;

    private HttpClient Client => _factory.CreateClient();

    [Fact]
    public async Task Stats_returns_reference_counts_and_most_used_concept()
    {
        var before = (await Client.GetFromJsonAsync<ConceptStatsDto>("/api/concepts/stats"))!;
        var suffix = Guid.NewGuid().ToString("N");
        var alpha = $"Stats Alpha {suffix}";
        var shared = $"Stats Shared {suffix}";
        var single = $"Stats Single {suffix}";

        var noteContents = new[]
        {
            $"[[{alpha}]] [[{shared}]] [[{single}]]",
            $"[[{alpha}]] [[{shared}]]",
        }
        .Concat(Enumerable.Repeat($"[[{alpha}]]", 8))
        .ToArray();
        await CreateBookWithNotesAsync(noteContents);

        var after = (await Client.GetFromJsonAsync<ConceptStatsDto>("/api/concepts/stats"))!;

        after.TotalConcepts.Should().Be(before.TotalConcepts + 3);
        after.TotalReferences.Should().Be(before.TotalReferences + 13);
        after.SingleNoteConcepts.Should().Be(before.SingleNoteConcepts + 1);
        after.MostUsedName.Should().Be(alpha);
        after.MostUsedCount.Should().Be(10);
    }

    [Fact]
    public async Task Related_returns_shared_concepts_in_usage_order_and_unknown_is_empty()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var anchorName = $"Related Anchor {suffix}";
        var sharedName = $"Related Shared {suffix}";
        var occasionalName = $"Related Occasional {suffix}";

        await CreateBookWithNotesAsync(
            $"[[{anchorName}]] [[{sharedName}]] [[{occasionalName}]]",
            $"[[{anchorName}]] [[{sharedName}]]",
            $"[[{anchorName}]]");

        var concepts = await GetConceptsAsync();
        var anchor = concepts.Single(c => c.Name == anchorName);

        var related = await Client.GetFromJsonAsync<RelatedConceptDto[]>(
            $"/api/concepts/{anchor.Id}/related");

        related.Should().Equal(
            new RelatedConceptDto(concepts.Single(c => c.Name == sharedName).Id, sharedName, 2),
            new RelatedConceptDto(concepts.Single(c => c.Name == occasionalName).Id, occasionalName, 1));

        var unknown = await Client.GetAsync($"/api/concepts/{Guid.NewGuid()}/related");
        unknown.StatusCode.Should().Be(HttpStatusCode.OK);
        (await unknown.Content.ReadFromJsonAsync<RelatedConceptDto[]>()).Should().BeEmpty();
    }

    [Fact]
    public async Task Detail_includes_note_created_at()
    {
        var conceptName = $"Created At {Guid.NewGuid():N}";
        var book = await CreateBookWithNotesAsync($"[[{conceptName}]]");
        var note = (await Client.GetFromJsonAsync<NoteDto[]>($"/api/books/{book.Id}/notes"))!.Single();
        var expected = new DateTime(2025, 4, 26, 15, 30, 0, DateTimeKind.Utc);

        await using (var db = await OpenDbAsync())
        {
            var stored = await db.Notes.SingleAsync(n => n.Id == note.Id);
            stored.CreatedAt = expected;
            await db.SaveChangesAsync();
        }

        var concept = (await GetConceptsAsync()).Single(c => c.Name == conceptName);
        var detail = (await Client.GetFromJsonAsync<ConceptDetailDto>(
            $"/api/concepts/{concept.Id}"))!;

        detail.Notes.Single().CreatedAt.Should().Be(expected);
    }

    [Fact]
    public async Task Rename_trims_name_and_unknown_id_returns_404()
    {
        var oldName = $"Rename Old {Guid.NewGuid():N}";
        var book = await CreateBookWithNotesAsync($"[[{oldName}]]");
        var oldConcept = (await GetConceptsAsync()).Single(c => c.Name == oldName);
        var newName = $"Rename New {Guid.NewGuid():N}";

        var response = await Client.PutAsJsonAsync(
            $"/api/concepts/{oldConcept.Id}",
            new UpdateConceptDto($"  {newName}  "));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<ConceptDto>())!.Name.Should().Be(newName);

        var unknown = await Client.PutAsJsonAsync(
            $"/api/concepts/{Guid.NewGuid()}",
            new UpdateConceptDto("Anything"));
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var notes = await Client.GetFromJsonAsync<NoteDto[]>($"/api/books/{book.Id}/notes");
        notes.Should().ContainSingle();
    }

    [Fact]
    public async Task Rename_to_existing_name_merges_and_deduplicates_note_links()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var sourceName = $"Rename Source {suffix}";
        var targetName = $"Rename Target {suffix}";
        await CreateBookWithNotesAsync(
            $"[[{sourceName}]] [[{targetName}]]",
            $"[[{sourceName}]]");

        var concepts = await GetConceptsAsync();
        var source = concepts.Single(c => c.Name == sourceName);
        var target = concepts.Single(c => c.Name == targetName);

        var response = await Client.PutAsJsonAsync(
            $"/api/concepts/{source.Id}",
            new UpdateConceptDto($" {targetName} "));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var survivor = (await response.Content.ReadFromJsonAsync<ConceptDto>())!;
        survivor.Id.Should().Be(target.Id);
        survivor.Name.Should().Be(targetName);
        survivor.UsageCount.Should().Be(2);

        await using var db = await OpenDbAsync();
        (await db.Concepts.FindAsync(source.Id)).Should().BeNull();
        (await db.NoteConcepts.CountAsync(nc => nc.ConceptId == target.Id)).Should().Be(2);
    }

    [Fact]
    public async Task Empty_rename_returns_400_without_changing_the_concept()
    {
        var name = $"Rename Validation {Guid.NewGuid():N}";
        await CreateBookWithNotesAsync($"[[{name}]]");
        var concept = (await GetConceptsAsync()).Single(c => c.Name == name);

        var response = await Client.PutAsJsonAsync(
            $"/api/concepts/{concept.Id}",
            new UpdateConceptDto("  "));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await GetConceptsAsync()).Should().Contain(c => c.Id == concept.Id && c.Name == name);
    }

    [Fact]
    public async Task Merge_moves_links_once_and_unknown_ids_return_404()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var sourceName = $"Merge Source {suffix}";
        var targetName = $"Merge Target {suffix}";
        await CreateBookWithNotesAsync(
            $"[[{sourceName}]] [[{targetName}]]",
            $"[[{sourceName}]]",
            $"[[{targetName}]]");

        var concepts = await GetConceptsAsync();
        var source = concepts.Single(c => c.Name == sourceName);
        var target = concepts.Single(c => c.Name == targetName);

        var response = await Client.PostAsJsonAsync(
            $"/api/concepts/{source.Id}/merge",
            new MergeConceptDto(target.Id));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var survivor = (await response.Content.ReadFromJsonAsync<ConceptDto>())!;
        survivor.Id.Should().Be(target.Id);
        survivor.UsageCount.Should().Be(3);

        await using (var db = await OpenDbAsync())
        {
            (await db.Concepts.FindAsync(source.Id)).Should().BeNull();
            (await db.NoteConcepts.CountAsync(nc => nc.ConceptId == target.Id)).Should().Be(3);
        }

        var unknownSource = await Client.PostAsJsonAsync(
            $"/api/concepts/{Guid.NewGuid()}/merge",
            new MergeConceptDto(target.Id));
        unknownSource.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var unknownTarget = await Client.PostAsJsonAsync(
            $"/api/concepts/{target.Id}/merge",
            new MergeConceptDto(Guid.NewGuid()));
        unknownTarget.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Self_merge_returns_400()
    {
        var name = $"Merge Self {Guid.NewGuid():N}";
        await CreateBookWithNotesAsync($"[[{name}]]");
        var concept = (await GetConceptsAsync()).Single(c => c.Name == name);

        var response = await Client.PostAsJsonAsync(
            $"/api/concepts/{concept.Id}/merge",
            new MergeConceptDto(concept.Id));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Delete_removes_concept_links_but_keeps_note_and_unknown_is_404()
    {
        var name = $"Delete Concept {Guid.NewGuid():N}";
        var book = await CreateBookWithNotesAsync($"Keep [[{name}]] text");
        var concept = (await GetConceptsAsync()).Single(c => c.Name == name);
        var notesBefore = await Client.GetFromJsonAsync<NoteDto[]>($"/api/books/{book.Id}/notes");

        var response = await Client.DeleteAsync($"/api/concepts/{concept.Id}");
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await using (var db = await OpenDbAsync())
        {
            (await db.Concepts.FindAsync(concept.Id)).Should().BeNull();
            (await db.NoteConcepts.CountAsync(nc => nc.ConceptId == concept.Id)).Should().Be(0);
            (await db.Notes.FindAsync(notesBefore!.Single().Id)).Should().NotBeNull();
        }

        var unknown = await Client.DeleteAsync($"/api/concepts/{Guid.NewGuid()}");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<BookDto> CreateBookWithNotesAsync(params string[] noteContents)
    {
        var bookResponse = await Client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"Concept endpoint test {Guid.NewGuid():N}",
        });
        bookResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var book = (await bookResponse.Content.ReadFromJsonAsync<BookDto>())!;

        foreach (var content in noteContents)
        {
            var noteResponse = await Client.PostAsJsonAsync(
                $"/api/books/{book.Id}/notes",
                new { content });
            noteResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        return book;
    }

    private async Task<ConceptDto[]> GetConceptsAsync() =>
        (await Client.GetFromJsonAsync<ConceptDto[]>("/api/concepts"))!;

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
