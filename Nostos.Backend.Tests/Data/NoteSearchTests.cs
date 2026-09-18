using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Data;

/// <summary>
/// Note-text search and the unlinked-note listing (issue #158).
///
/// The defect these close: the index could only match concept NAMES, so a word
/// living only in a note's body or quote was unreachable, and a note belonging to
/// no concept could not be reached at all.
/// </summary>
public sealed class NoteSearchTests
{
    private static async Task<(AcquisitionHarness Harness, Guid BookId, Guid LinkedNoteId, Guid UnlinkedNoteId)>
        SeedAsync()
    {
        var harness = AcquisitionHarness.Create();

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        // BookModel is abstract (the concrete type is what a reader owns); the
        // physical subtype needs no extra columns for this fixture.
        var book = new PhysicalBookModel { Id = Guid.NewGuid(), Title = "Nostos Test Book" };
        db.Books.Add(book);

        var concept = new ConceptModel { Id = Guid.NewGuid(), Concept = "virtue" };
        db.Concepts.Add(concept);

        // One note that belongs to a concept, one that belongs to none — the case
        // the index could never surface.
        var linked = new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = book.Id,
            Content = "Sisyphus is condemned to a task that is boring, difficult and futile.",
            SelectedText = "the perpetual performance of a task that is boring",
            CreatedAt = DateTime.UtcNow,
        };
        var unlinked = new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = book.Id,
            Content = "An unrelated remark about marginalia.",
            SelectedText = "objective-list smuggling",
            CreatedAt = DateTime.UtcNow.AddSeconds(-5),
        };
        db.Notes.AddRange(linked, unlinked);
        db.NoteConcepts.Add(new NoteConceptModel { NoteId = linked.Id, ConceptId = concept.Id });
        await db.SaveChangesAsync();

        return (harness, book.Id, linked.Id, unlinked.Id);
    }

    [Fact]
    public async Task Finds_a_note_by_words_in_its_body()
    {
        var (harness, _, linkedId, _) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        var hits = await new NoteRepository(db).SearchByTextAsync("Sisyphus", 50);

        hits.Should().ContainSingle().Which.Id.Should().Be(linkedId);
    }

    [Fact]
    public async Task Finds_a_note_by_words_in_the_quotation_it_captured()
    {
        // The quoted passage is usually the only place the book's own words appear.
        var (harness, _, linkedId, _) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        var hits = await new NoteRepository(db).SearchByTextAsync("perpetual performance", 50);

        hits.Should().ContainSingle().Which.Id.Should().Be(linkedId);
    }

    [Fact]
    public async Task Finds_the_notes_of_a_book_by_its_title()
    {
        var (harness, _, _, _) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        var hits = await new NoteRepository(db).SearchByTextAsync("Nostos Test Book", 50);

        hits.Should().HaveCount(2);
    }

    [Fact]
    public async Task Searches_a_note_that_belongs_to_no_concept()
    {
        // The whole point of #158: this note has no concept row to be reached by.
        var (harness, _, _, unlinkedId) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        var hits = await new NoteRepository(db).SearchByTextAsync("marginalia", 50);

        hits.Should().ContainSingle().Which.Id.Should().Be(unlinkedId);
    }

    [Fact]
    public async Task Treats_wildcards_as_text_instead_of_matching_everything()
    {
        var (harness, _, _, _) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        var repo = new NoteRepository(db);

        // A bare `%` is a LIKE wildcard: unescaped, this would return every note.
        (await repo.SearchByTextAsync("%", 50)).Should().BeEmpty();
        (await repo.SearchByTextAsync("_", 50)).Should().BeEmpty();
    }

    [Fact]
    public async Task An_empty_query_returns_nothing_rather_than_everything()
    {
        var (harness, _, _, _) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();

        (await new NoteRepository(db).SearchByTextAsync("   ", 50)).Should().BeEmpty();
    }

    [Fact]
    public async Task Lists_only_the_notes_that_belong_to_no_concept()
    {
        var (harness, _, _, unlinkedId) = await SeedAsync();
        using var _h = harness;

        await using var db = await harness.ContextFactory.CreateDbContextAsync();
        var unlinked = await new NoteRepository(db).GetWithoutConceptsAsync(50);

        unlinked.Should().ContainSingle().Which.Id.Should().Be(unlinkedId);
    }
}
