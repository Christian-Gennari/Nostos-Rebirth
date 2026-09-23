using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Synthetic seed data fixture for assistant measurement scenarios.
/// Uses deterministic GUIDs for stable identifiers across runs.
/// </summary>
public static class SyntheticLibraryFixture
{
    private static Guid MakeGuid(int index) => new($"00000000-0000-0000-0000-{index:D12}");

    public static readonly Guid Book01Id = MakeGuid(1);
    public static readonly Guid Book02Id = MakeGuid(2);
    public static readonly Guid Book03Id = MakeGuid(3);
    public static readonly Guid Book04Id = MakeGuid(4);
    public static readonly Guid Book05Id = MakeGuid(5);
    public static readonly Guid Book06Id = MakeGuid(6);
    public static readonly Guid Book07Id = MakeGuid(7);
    public static readonly Guid Book08Id = MakeGuid(8);
    public static readonly Guid Book09Id = MakeGuid(9);
    public static readonly Guid Book10Id = MakeGuid(10);
    public static readonly Guid Book11Id = MakeGuid(11);
    public static readonly Guid Book12Id = MakeGuid(12);

    public static readonly Guid UnlinkedReviewNoteId = MakeGuid(120);

    public static readonly Guid CollectionPhilosophyId = MakeGuid(201);
    public static readonly Guid CollectionEssaysId = MakeGuid(202);
    public static readonly Guid CollectionResearchId = MakeGuid(203);
    public static readonly Guid CollectionFictionId = MakeGuid(204);
    public static readonly Guid CollectionToReadNextId = MakeGuid(205);
    public static readonly Guid CollectionOldDraftsId = MakeGuid(206);

    public static readonly Guid ConceptAttentionEconomicsId = MakeGuid(301);
    public static readonly Guid ConceptDeepWorkId = MakeGuid(302);
    public static readonly Guid ConceptHabitFormationId = MakeGuid(303);
    public static readonly Guid ConceptDigitalMinimalismId = MakeGuid(304);
    public static readonly Guid ConceptFlowStateId = MakeGuid(305);
    public static readonly Guid ConceptCognitiveLoadId = MakeGuid(306);
    public static readonly Guid ConceptDeliberatePracticeId = MakeGuid(307);
    public static readonly Guid ConceptKnowledgeManagementId = MakeGuid(308);

    public static async Task<SyntheticLibrarySeedResult> Seed(NostosDbContext db)
    {
        ArgumentNullException.ThrowIfNull(db);

        var work = new WorkModel
        {
            Id = MakeGuid(999),
            Title = "Synthetic Work Group",
            Author = "Fixture Author",
            NormalizedTitle = "SYNTHETIC WORK GROUP",
            NormalizedAuthor = "FIXTURE AUTHOR",
        };
        db.Works.Add(work);

        var books = new List<BookModel>
        {
            new EBookModel
            {
                Id = Book01Id,
                Title = "Synthetic Book 01: The Attention Economy",
                Author = "Fixture Author",
                WorkId = work.Id,
                FileDetails = new FileInfoDetails { HasFile = true, FileName = "book01.epub" }
            },
            new EBookModel
            {
                Id = Book02Id,
                Title = "Synthetic Book 02: Deep Work Patterns",
                Author = "Fixture Author",
                WorkId = work.Id,
                FileDetails = new FileInfoDetails { HasFile = true, FileName = "book02.epub" }
            },
            new EBookModel
            {
                Id = Book03Id,
                Title = "Synthetic Book 03: Designing Systems",
                Author = "Fixture Author",
                WorkId = work.Id,
            },
            new EBookModel
            {
                Id = Book04Id,
                Title = "Synthetic Book 04: The Habit Blueprint",
                Author = "Fixture Author",
                WorkId = work.Id,
            },
            new PhysicalBookModel
            {
                Id = Book05Id,
                Title = "Synthetic Book 05: On Patience",
                Author = "Fixture Author",
                WorkId = work.Id,
                PageCount = 320,
            },
            new PhysicalBookModel
            {
                Id = Book06Id,
                Title = "Synthetic Book 06: Craft and Focus",
                Author = "Fixture Author",
                WorkId = work.Id,
                PageCount = 280,
            },
            new PhysicalBookModel
            {
                Id = Book07Id,
                Title = "Synthetic Book 07: Epictetus Reconsidered",
                Author = "Fixture Author",
                WorkId = work.Id,
                PageCount = 190,
            },
            new PhysicalBookModel
            {
                Id = Book08Id,
                Title = "Synthetic Book 08: Principles of Navigation",
                Author = "Fixture Author",
                WorkId = work.Id,
                PageCount = 410,
            },
            new AudioBookModel
            {
                Id = Book09Id,
                Title = "Synthetic Book 09: Audio Essays on Solitude",
                Author = "Fixture Author",
                WorkId = work.Id,
                Duration = "06:45:00",
                Narrator = "Voice One",
            },
            new AudioBookModel
            {
                Id = Book10Id,
                Title = "Synthetic Book 10: Voices of the Coast",
                Author = "Fixture Author",
                WorkId = work.Id,
                Duration = "08:12:00",
                Narrator = "Voice Two",
            },
            new AudioBookModel
            {
                Id = Book11Id,
                Title = "Synthetic Book 11: The Focused Mind In Audio",
                Author = "Fixture Author",
                WorkId = work.Id,
                Duration = "05:30:00",
                Narrator = "Voice Three",
            },
            new EBookModel
            {
                Id = Book12Id,
                Title = "Synthetic Book 12: Modern Fiction Chronicles",
                Author = "Fixture Author",
                WorkId = work.Id,
            },
        };

        db.Books.AddRange(books);

        var collections = new List<CollectionModel>
        {
            new() { Id = CollectionPhilosophyId, Name = "Philosophy" },
            new() { Id = CollectionEssaysId, Name = "Essays" },
            new() { Id = CollectionResearchId, Name = "Research" },
            new() { Id = CollectionFictionId, Name = "Fiction" },
            new() { Id = CollectionToReadNextId, Name = "To Read Next" },
            new() { Id = CollectionOldDraftsId, Name = "Old Drafts" },
        };
        db.Collections.AddRange(collections);

        // Old Drafts contains 2 books so deleting it requires approval
        db.BookCollections.AddRange(
            new BookCollectionModel { BookId = Book01Id, CollectionId = CollectionOldDraftsId },
            new BookCollectionModel { BookId = Book02Id, CollectionId = CollectionOldDraftsId },
            new BookCollectionModel { BookId = Book05Id, CollectionId = CollectionPhilosophyId },
            new BookCollectionModel { BookId = Book12Id, CollectionId = CollectionFictionId });

        var concepts = new List<ConceptModel>
        {
            new() { Id = ConceptAttentionEconomicsId, Concept = "Attention Economics" },
            new() { Id = ConceptDeepWorkId, Concept = "Deep Work" },
            new() { Id = ConceptHabitFormationId, Concept = "Habit Formation" },
            new() { Id = ConceptDigitalMinimalismId, Concept = "Digital Minimalism" },
            new() { Id = ConceptFlowStateId, Concept = "Flow State" },
            new() { Id = ConceptCognitiveLoadId, Concept = "Cognitive Load" },
            new() { Id = ConceptDeliberatePracticeId, Concept = "Deliberate Practice" },
            new() { Id = ConceptKnowledgeManagementId, Concept = "Knowledge Management" },
        };
        db.Concepts.AddRange(concepts);

        // 20 notes, at least 5 mention attention, exactly one unlinked review note
        var notes = new List<NoteModel>
        {
            new() { Id = MakeGuid(101), BookId = Book01Id, Content = "Synthetic note 01 — attention is the bottleneck in deep work; the inbox is not a priority list." },
            new() { Id = MakeGuid(102), BookId = Book01Id, Content = "Synthetic note 02 — fragmented attention impairs sustained synthesis." },
            new() { Id = MakeGuid(103), BookId = Book01Id, Content = "Synthetic note 03 — protecting attention requires intentional boundary setting." },
            new() { Id = MakeGuid(104), BookId = Book02Id, Content = "Synthetic note 04 — sustained attention produces higher quality intellectual output." },
            new() { Id = MakeGuid(105), BookId = Book02Id, Content = "Synthetic note 05 — the economy of attention penalizes cognitive context switches." },
            new() { Id = MakeGuid(106), BookId = Book03Id, Content = "Synthetic note 06 — modular system architecture limits unexpected ripple effects." },
            new() { Id = MakeGuid(107), BookId = Book03Id, Content = "Synthetic note 07 — explicit interfaces clarify boundary responsibilities." },
            new() { Id = MakeGuid(108), BookId = Book04Id, Content = "Synthetic note 08 — habits form through reliable cue-response consistency." },
            new() { Id = MakeGuid(109), BookId = Book04Id, Content = "Synthetic note 09 — small routines aggregate into profound lifestyle shifts." },
            new() { Id = MakeGuid(110), BookId = Book05Id, Content = "Synthetic note 10 — patience remains the ultimate competitive advantage." },
            new() { Id = MakeGuid(111), BookId = Book05Id, Content = "Synthetic note 11 — waiting deliberately differs from passive procrastination." },
            new() { Id = MakeGuid(112), BookId = Book06Id, Content = "Synthetic note 12 — craftsmanship demands iterative refinement without shortcuts." },
            new() { Id = MakeGuid(113), BookId = Book07Id, Content = "Synthetic note 13 — stoic resilience begins with distinguishing control from circumstance." },
            new() { Id = MakeGuid(114), BookId = Book08Id, Content = "Synthetic note 14 — orientation precedes velocity in unfamiliar terrain." },
            new() { Id = MakeGuid(115), BookId = Book09Id, Content = "Synthetic note 15 — solitude provides the quiet space necessary for self-reflection." },
            new() { Id = MakeGuid(116), BookId = Book10Id, Content = "Synthetic note 16 — maritime narratives highlight nature's persistent indifference." },
            new() { Id = MakeGuid(117), BookId = Book11Id, Content = "Synthetic note 17 — auditory focus activates complementary associative faculties." },
            new() { Id = MakeGuid(118), BookId = Book12Id, Content = "Synthetic note 18 — narrative fiction exposes psychological subtleties." },
            new() { Id = MakeGuid(119), BookId = Book01Id, Content = "Synthetic note 19 — information abundance naturally generates attention scarcity." },
            new() { Id = UnlinkedReviewNoteId, BookId = Book02Id, Content = "Synthetic note 20 — deep focus patterns require deliberate environmental design." }
        };
        db.Notes.AddRange(notes);

        // Link non-review notes to concepts
        db.NoteConcepts.AddRange(
            new NoteConceptModel { NoteId = MakeGuid(101), ConceptId = ConceptAttentionEconomicsId },
            new NoteConceptModel { NoteId = MakeGuid(102), ConceptId = ConceptAttentionEconomicsId },
            new NoteConceptModel { NoteId = MakeGuid(103), ConceptId = ConceptDigitalMinimalismId },
            new NoteConceptModel { NoteId = MakeGuid(104), ConceptId = ConceptDeepWorkId },
            new NoteConceptModel { NoteId = MakeGuid(105), ConceptId = ConceptAttentionEconomicsId },
            new NoteConceptModel { NoteId = MakeGuid(108), ConceptId = ConceptHabitFormationId },
            new NoteConceptModel { NoteId = MakeGuid(109), ConceptId = ConceptHabitFormationId },
            new NoteConceptModel { NoteId = MakeGuid(112), ConceptId = ConceptDeliberatePracticeId },
            new NoteConceptModel { NoteId = MakeGuid(119), ConceptId = ConceptAttentionEconomicsId });

        await db.SaveChangesAsync();

        return new SyntheticLibrarySeedResult(
            Book01Id,
            Book02Id,
            Book05Id,
            UnlinkedReviewNoteId,
            CollectionOldDraftsId);
    }
}

/// <summary>
/// Record containing key identifiers seeded by <see cref="SyntheticLibraryFixture"/>.
/// </summary>
public sealed record SyntheticLibrarySeedResult(
    Guid Book01Id,
    Guid Book02Id,
    Guid Book05Id,
    Guid UnlinkedReviewNoteId,
    Guid OldDraftsCollectionId);
