using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Mapping;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Data;

public sealed class WritingKeptNotesPersistenceTests : IClassFixture<SqliteTestFixture>
{
    private readonly SqliteTestFixture _fixture;

    public WritingKeptNotesPersistenceTests(SqliteTestFixture fixture)
    {
        _fixture = fixture;
    }

    private static (BookModel Book, NoteModel Note, WritingModel Document) SeedStandardGraph(NostosDbContext db)
    {
        var book = new PhysicalBookModel
        {
            Id = Guid.NewGuid(),
            Title = "The Republic",
            Author = "Plato",
            CreatedAt = DateTime.UtcNow.AddDays(-5),
        };
        var note = new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = book.Id,
            Book = book,
            Content = "Justice is harmony in the soul.",
            SelectedText = "justice is harmony",
            CfiRange = "epubcfi(/6/4)",
            CreatedAt = DateTime.UtcNow.AddDays(-2),
            SourceAnchorKind = "epub_cfi",
            SourceAnchorValue = "epubcfi(/6/4)",
            AnchorVerified = true,
        };
        var document = new WritingModel
        {
            Id = Guid.NewGuid(),
            Name = "Draft on Justice",
            Type = WritingType.Document,
            Content = "<p>Introductory paragraph</p>",
            CreatedAt = DateTime.UtcNow.AddDays(-1),
            UpdatedAt = DateTime.UtcNow.AddDays(-1),
        };

        db.Books.Add(book);
        db.Notes.Add(note);
        db.Writings.Add(document);
        db.SaveChanges();

        return (book, note, document);
    }

    // 1. add a kept source → one row; list returns it with live note content + book title.
    [Fact]
    public async Task AddKeptSource_CreatesOneRow_AndListReturnsLiveNoteContentAndBookTitle()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (book, note, doc) = SeedStandardGraph(db);
        var repo = new WritingRepository(db);

        var addResult = await repo.AddKeptNoteAsync(doc.Id, note.Id);
        addResult.Status.Should().Be(AddKeptNoteStatus.Success);
        addResult.WritingNote.Should().NotBeNull();

        var keptNotes = await repo.GetKeptNotesAsync(doc.Id);
        keptNotes.Should().NotBeNull();
        keptNotes!.Should().ContainSingle();

        var dto = keptNotes!.Single().ToDto();
        dto.Id.Should().Be(note.Id);
        dto.BookId.Should().Be(book.Id);
        dto.BookTitle.Should().Be("The Republic");
        dto.Content.Should().Be("Justice is harmony in the soul.");
        dto.SelectedText.Should().Be("justice is harmony");
        dto.CfiRange.Should().Be("epubcfi(/6/4)");
        dto.SourceAnchorKind.Should().Be("epub_cfi");
        dto.SourceAnchorValue.Should().Be("epubcfi(/6/4)");
        dto.AnchorVerified.Should().BeTrue();
        dto.CreatedAt.Should().Be(note.CreatedAt);
        dto.AddedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));

        // Mutate note content directly to prove live canonical read at request time (no excerpt cache)
        note.Content = "Justice is an order of the soul and state.";
        await db.SaveChangesAsync();

        var refreshed = await repo.GetKeptNotesAsync(doc.Id);
        refreshed!.Single().ToDto().Content.Should().Be("Justice is an order of the soul and state.");
    }

    // 2. duplicate add is idempotent → still exactly one row (and the second call succeeds).
    [Fact]
    public async Task DuplicateAdd_IsIdempotent_YieldsExactlyOneRowAndSucceeds()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (_, note, doc) = SeedStandardGraph(db);
        var repo = new WritingRepository(db);

        var first = await repo.AddKeptNoteAsync(doc.Id, note.Id);
        first.Status.Should().Be(AddKeptNoteStatus.Success);
        var originalAddedAt = first.WritingNote!.AddedAt;

        var second = await repo.AddKeptNoteAsync(doc.Id, note.Id);
        second.Status.Should().Be(AddKeptNoteStatus.AlreadyExists);
        second.WritingNote.Should().NotBeNull();
        second.WritingNote!.AddedAt.Should().Be(originalAddedAt);

        (await db.WritingNotes.CountAsync(wn => wn.WritingId == doc.Id && wn.NoteId == note.Id))
            .Should().Be(1);
    }

    // 3. remove → row gone, note still exists, writing still exists.
    [Fact]
    public async Task RemoveKeptSource_RemovesMembershipRow_WhileNoteAndWritingRemain()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (_, note, doc) = SeedStandardGraph(db);
        var repo = new WritingRepository(db);

        await repo.AddKeptNoteAsync(doc.Id, note.Id);
        (await db.WritingNotes.CountAsync()).Should().Be(1);

        var removed = await repo.RemoveKeptNoteAsync(doc.Id, note.Id);
        removed.Should().BeTrue();

        (await db.WritingNotes.CountAsync(wn => wn.WritingId == doc.Id && wn.NoteId == note.Id))
            .Should().Be(0);
        (await db.Notes.AnyAsync(n => n.Id == note.Id)).Should().BeTrue();
        (await db.Writings.AnyAsync(w => w.Id == doc.Id)).Should().BeTrue();

        // Idempotent remove: removing again returns true
        var secondRemove = await repo.RemoveKeptNoteAsync(doc.Id, note.Id);
        secondRemove.Should().BeTrue();
    }

    // 4. reload persistence: write, dispose the context, re-read from the same SQLite file.
    [Fact]
    public async Task ReloadPersistence_ReReadingFromSameSqliteFile_PreservesMembership()
    {
        var dbPath = _fixture.CreateDatabasePath();
        Guid docId;
        Guid noteId;
        DateTime addedAt;

        using (var db = _fixture.CreateContext(dbPath))
        {
            var (_, note, doc) = SeedStandardGraph(db);
            var repo = new WritingRepository(db);
            var result = await repo.AddKeptNoteAsync(doc.Id, note.Id);
            result.Status.Should().Be(AddKeptNoteStatus.Success);
            docId = doc.Id;
            noteId = note.Id;
            addedAt = result.WritingNote!.AddedAt;
        }

        // Fresh context pointing to the same SQLite file
        using (var newDb = _fixture.CreateContext(dbPath))
        {
            var repo = new WritingRepository(newDb);
            var kept = await repo.GetKeptNotesAsync(docId);
            kept.Should().NotBeNull();
            kept!.Should().ContainSingle();

            var dto = kept!.Single().ToDto();
            dto.Id.Should().Be(noteId);
            dto.BookTitle.Should().Be("The Republic");
            dto.AddedAt.Should().Be(addedAt);
        }
    }

    // 5. deleting a writing removes its membership rows and never the source notes
    //    (also: deleting a folder removes memberships of its documents).
    [Fact]
    public async Task DeletingWriting_OrFolder_RemovesMembershipRowsAndNeverSourceNotes()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (_, note, doc) = SeedStandardGraph(db);
        var repo = new WritingRepository(db);

        await repo.AddKeptNoteAsync(doc.Id, note.Id);

        // Delete writing document
        await repo.DeleteAsync(doc);

        (await db.WritingNotes.AnyAsync(wn => wn.WritingId == doc.Id)).Should().BeFalse();
        (await db.Notes.AnyAsync(n => n.Id == note.Id)).Should().BeTrue("note must not be deleted");

        // Folder cascade test: deleting folder removes document and its membership rows
        var folder = new WritingModel
        {
            Id = Guid.NewGuid(),
            Name = "Essays Folder",
            Type = WritingType.Folder,
        };
        var childDoc = new WritingModel
        {
            Id = Guid.NewGuid(),
            Name = "Nested Essay",
            Type = WritingType.Document,
            ParentId = folder.Id,
            Parent = folder,
        };
        db.Writings.AddRange(folder, childDoc);
        await db.SaveChangesAsync();

        await repo.AddKeptNoteAsync(childDoc.Id, note.Id);
        (await db.WritingNotes.AnyAsync(wn => wn.WritingId == childDoc.Id)).Should().BeTrue();

        // Delete parent folder
        await repo.DeleteAsync(folder);

        (await db.Writings.AnyAsync(w => w.Id == childDoc.Id)).Should().BeFalse();
        (await db.WritingNotes.AnyAsync(wn => wn.WritingId == childDoc.Id)).Should().BeFalse();
        (await db.Notes.AnyAsync(n => n.Id == note.Id)).Should().BeTrue("source note survives folder cascade");
    }

    // 6. deleting a note removes its membership rows and never the writing;
    //    deleting a book removes its notes and their memberships without an FK exception.
    [Fact]
    public async Task DeletingNoteOrBook_CascadesMembershipsWithoutFkException()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (book, note, doc) = SeedStandardGraph(db);
        var repo = new WritingRepository(db);

        await repo.AddKeptNoteAsync(doc.Id, note.Id);

        // 6a: Deleting a note removes its membership and never the writing
        db.Notes.Remove(note);
        await db.SaveChangesAsync();

        (await db.WritingNotes.AnyAsync(wn => wn.NoteId == note.Id)).Should().BeFalse();
        (await db.Writings.AnyAsync(w => w.Id == doc.Id)).Should().BeTrue();

        // 6b: Deleting a book cascades through notes to memberships without throwing an FK exception
        var secondNote = new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = book.Id,
            Book = book,
            Content = "Second note on the book",
        };
        db.Notes.Add(secondNote);
        await db.SaveChangesAsync();

        await repo.AddKeptNoteAsync(doc.Id, secondNote.Id);
        (await db.WritingNotes.AnyAsync(wn => wn.NoteId == secondNote.Id)).Should().BeTrue();

        // Deleting the book cascades: Book -> Notes -> WritingNotes
        db.Books.Remove(book);
        Func<Task> deleteBook = () => db.SaveChangesAsync();
        await deleteBook.Should().NotThrowAsync("both sides cascade so deleting book removes notes and memberships cleanly");

        (await db.WritingNotes.AnyAsync(wn => wn.NoteId == secondNote.Id)).Should().BeFalse();
        (await db.Notes.AnyAsync(n => n.Id == secondNote.Id)).Should().BeFalse();
        (await db.Writings.AnyAsync(w => w.Id == doc.Id)).Should().BeTrue("writing survives book deletion");
    }

    // 6b. degenerate dangling row never crashes the read path
    [Fact]
    public async Task DegenerateDanglingRow_NeverCrashesReadPath_AndIsOmittedFromList()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (_, note, doc) = SeedStandardGraph(db);
        var repo = new WritingRepository(db);

        await repo.AddKeptNoteAsync(doc.Id, note.Id);

        // Insert a degenerate dangling membership row directly via SQLite connection with FKs OFF
        var danglingNoteId = Guid.NewGuid();
        await using (var conn = new SqliteConnection($"Data Source={dbPath}"))
        {
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                PRAGMA foreign_keys = OFF;
                INSERT INTO WritingNotes (WritingId, NoteId, AddedAt)
                VALUES ($writingId, $noteId, $addedAt);";
            cmd.Parameters.AddWithValue("$writingId", doc.Id.ToString());
            cmd.Parameters.AddWithValue("$noteId", danglingNoteId.ToString());
            cmd.Parameters.AddWithValue("$addedAt", DateTime.UtcNow.ToString("O"));
            await cmd.ExecuteNonQueryAsync();
        }

        // Re-read via repository: defensive read path must not throw and must omit the unavailable row
        using var freshDb = _fixture.CreateContext(dbPath);
        var freshRepo = new WritingRepository(freshDb);
        var list = await freshRepo.GetKeptNotesAsync(doc.Id);

        list.Should().NotBeNull();
        list!.Should().ContainSingle();
        list!.Single().NoteId.Should().Be(note.Id);
    }

    // 7. multiple kept notes come back in chronological accretion order (AddedAt ASC,
    //    then NoteId) — the display contract the Studio's "For this writing" list relies on.
    [Fact]
    public async Task GetKeptNotes_MultipleNotes_ReturnsInAddedAtAscendingOrder()
    {
        var dbPath = _fixture.CreateDatabasePath();
        using var db = _fixture.CreateContext(dbPath);
        var (book, note1, doc) = SeedStandardGraph(db);

        var note2 = new NoteModel { Id = Guid.NewGuid(), BookId = book.Id, Book = book, Content = "Second note", CreatedAt = DateTime.UtcNow.AddDays(-1) };
        var note3 = new NoteModel { Id = Guid.NewGuid(), BookId = book.Id, Book = book, Content = "Third note", CreatedAt = DateTime.UtcNow };
        db.Notes.AddRange(note2, note3);
        await db.SaveChangesAsync();

        var repo = new WritingRepository(db);
        (await repo.AddKeptNoteAsync(doc.Id, note1.Id)).Status.Should().Be(AddKeptNoteStatus.Success);
        (await repo.AddKeptNoteAsync(doc.Id, note2.Id)).Status.Should().Be(AddKeptNoteStatus.Success);
        (await repo.AddKeptNoteAsync(doc.Id, note3.Id)).Status.Should().Be(AddKeptNoteStatus.Success);

        // Pin explicit, scrambled timestamps so the assertion tests the ORDER BY,
        // not the clock resolution of three back-to-back inserts.
        var baseTime = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var rows = await db.WritingNotes.Where(wn => wn.WritingId == doc.Id).ToListAsync();
        rows.Single(wn => wn.NoteId == note2.Id).AddedAt = baseTime;                    // kept first
        rows.Single(wn => wn.NoteId == note3.Id).AddedAt = baseTime.AddMinutes(1);      // kept second
        rows.Single(wn => wn.NoteId == note1.Id).AddedAt = baseTime.AddMinutes(2);      // kept last
        await db.SaveChangesAsync();

        using var freshDb = _fixture.CreateContext(dbPath);
        var list = await new WritingRepository(freshDb).GetKeptNotesAsync(doc.Id);

        list!.Select(wn => wn.NoteId).Should().ContainInOrder(note2.Id, note3.Id, note1.Id);
    }
}
