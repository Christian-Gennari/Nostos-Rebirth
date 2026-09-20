using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Services.Notes;
using Nostos.Backend.Tests.Services.Ai;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Assistant;

/// <summary>
/// The assistant bridge (issue #261 §3, §4, §7). These tests drive the real
/// orchestrator over the real capability registry and a real SQLite database,
/// with the LLM replaced by <see cref="FakeLlmProvider"/>. They prove the trust
/// classes end to end: capture mutates, suggest does not, and PlanAndAct mutates
/// only through an approval bound to one plan id.
/// </summary>
public sealed class AssistantOrchestratorTests : IClassFixture<SqliteTestFixture>
{
    private readonly SqliteTestFixture _fixture;

    public AssistantOrchestratorTests(SqliteTestFixture fixture) => _fixture = fixture;

    // ------------------------------------------------------------------
    // Capture — executes immediately
    // ------------------------------------------------------------------

    [Fact]
    public async Task Capture_intent_executes_immediately_and_the_note_exists()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h, "The Magic Mountain");

        h.Llm
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"A captured thought"}""")
            .Returns("Saved that for you.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this thought.",
            Context(
                bookId: book.Id.ToString(),
                bookTitle: "The Magic Mountain",
                bookFormat: "ebook",
                readerType: "epub",
                epubCfi: "epubcfi(/6/4[chap01]!/4/2/2)")));

        response.Acknowledgement.Should().NotBeNullOrWhiteSpace();
        response.Acknowledgement.Should().Contain("The Magic Mountain");

        await using var db = await h.Factory.CreateDbContextAsync();
        var note = await db.Notes.AsNoTracking().SingleAsync();
        note.Content.Should().Be("A captured thought");
        note.SourceAnchorKind.Should().Be("epub_cfi");
        note.AnchorVerified.Should().BeTrue();
    }

    [Fact]
    public async Task Capture_retries_with_the_same_client_and_key_stay_exactly_once()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);

        h.Llm
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"Captured once"}""")
            .Returns("Saved.")
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"Captured once"}""")
            .Returns("Saved.");

        var context = Context(bookId: book.Id.ToString(), bookFormat: "ebook");
        await h.Orchestrator.HandleTurnAsync(Turn("Remember.", context, idem: "idem-1"));
        await h.Orchestrator.HandleTurnAsync(Turn("Remember.", context, idem: "idem-1"));

        await using var db = await h.Factory.CreateDbContextAsync();
        (await db.Notes.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task The_orchestrator_owns_the_anchor_and_never_trusts_a_guessed_one()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);

        // The model tries to supply a location; the format is an ebook with no
        // known CFI, so the orchestrator must not accept it.
        h.Llm
            .CallsTool(
                "notes_capture",
                $$"""
                {"bookId":"{{book.Id}}","content":"A thought",
                 "sourceAnchorKind":"pdf_page","sourceAnchorValue":"999","anchorVerified":true}
                """)
            .Returns("Saved.");

        await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this.",
            Context(bookId: book.Id.ToString(), bookFormat: "ebook")));

        await using var db = await h.Factory.CreateDbContextAsync();
        var note = await db.Notes.AsNoTracking().SingleAsync();
        note.SourceAnchorKind.Should().Be("unknown");
        note.SourceAnchorValue.Should().BeNull();
        note.AnchorVerified.Should().BeFalse();
    }

    [Fact]
    public async Task A_hand_typed_quote_carries_the_fidelity_note_into_the_acknowledgement()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);

        h.Llm
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"My thought about it"}""")
            .Returns("Saved.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this quote.",
            Context(
                bookId: book.Id.ToString(),
                bookFormat: "ebook",
                selectedText: "A passage I typed out")));

        response.Acknowledgement.Should().Contain(AssistantOrchestrator.QuoteFidelityNote);

        await using var db = await h.Factory.CreateDbContextAsync();
        var note = await db.Notes.AsNoTracking().SingleAsync();
        note.Content.Should().Contain(AssistantOrchestrator.QuoteFidelityNote);
        note.SelectedText.Should().Be("A passage I typed out");
        note.AnchorVerified.Should().BeFalse();
    }

    // ------------------------------------------------------------------
    // Suggest — never mutates
    // ------------------------------------------------------------------

    [Fact]
    public async Task Suggest_intent_changes_nothing_and_returns_suggestions()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h, "Seeded Book");
        await SeedNoteAsync(h, book.Id, "seeded note text");
        await SeedConceptAsync(h, "Seeded Concept");

        var before = await StoreSnapshotAsync(h);

        h.Llm
            .CallsTool("concepts_list")
            .Returns("Here are a few concepts from your library.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Where could this note belong?",
            Context(surface: "second-brain", route: "/second-brain")));

        response.Suggestions.Should().Contain(s => s.Kind == "concept" && s.Label == "Seeded Concept");

        (await StoreSnapshotAsync(h)).Should().BeEquivalentTo(before);
    }

    // ------------------------------------------------------------------
    // Brain review — existing-concept suggestions only (#261 §5)
    // ------------------------------------------------------------------

    [Fact]
    public async Task Brain_review_note_context_drives_concept_suggestions_without_mutating()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h, "The Magic Mountain");
        var note = await SeedNoteAsync(h, book.Id, "Hans Castorp on the mountain");
        await SeedConceptAsync(h, "Mountains");
        await SeedConceptAsync(h, "The Alps");

        var before = await StoreSnapshotAsync(h);

        // The model reads the reviewed note and lists concepts: the flow the
        // review-note context instructs it to follow.
        h.Llm
            .CallsTool("notes_read_for_review", $$"""{"noteId":"{{note.Id}}"}""")
            .CallsTool("concepts_list")
            .Returns("A couple of concepts look right.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Where do you think this belongs?",
            Context(
                surface: "second-brain",
                route: "/second-brain",
                brainReviewNoteId: note.Id.ToString())));

        response.Suggestions.Should().NotBeEmpty();
        response.Suggestions.Should().OnlyContain(s => s.Kind == "concept");
        response.Suggestions.Should().HaveCountLessThanOrEqualTo(AssistantOrchestrator.MaxConceptSuggestions);
        response.Suggestions.Select(s => s.Label).Should().BeSubsetOf(["Mountains", "The Alps"]);

        // Suggesting is not linking: neither the note nor any concept changed.
        (await StoreSnapshotAsync(h)).Should().BeEquivalentTo(before);

        // The reviewed note id reaches the model so notes_read_for_review can use it.
        h.Llm.Requests[0].Messages
            .Should().Contain(m => m.Content != null && m.Content.Contains(note.Id.ToString()));
    }

    [Fact]
    public async Task Concept_suggestions_are_capped_and_never_create_a_concept()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);
        var note = await SeedNoteAsync(h, book.Id, "A note with no concept");
        var seeded = new List<string>();
        for (var i = 1; i <= 8; i++)
        {
            seeded.Add((await SeedConceptAsync(h, $"Concept {i}")).Concept);
        }

        var before = await StoreSnapshotAsync(h);

        h.Llm
            .CallsTool("notes_read_for_review", $$"""{"noteId":"{{note.Id}}"}""")
            .CallsTool("concepts_list")
            .Returns("Ideas.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Where does this belong?",
            Context(
                surface: "second-brain",
                route: "/second-brain",
                brainReviewNoteId: note.Id.ToString())));

        response.Suggestions.Should().HaveCount(AssistantOrchestrator.MaxConceptSuggestions);
        response.Suggestions.Select(s => s.Label).Should().BeSubsetOf(seeded);

        // Zero concepts created to satisfy the suggestions.
        (await StoreSnapshotAsync(h)).Should().BeEquivalentTo(before);
    }

    // ------------------------------------------------------------------
    // Collections — inspect, propose, approve (#261 §6)
    // ------------------------------------------------------------------

    [Fact]
    public async Task Collections_inspection_produces_a_pending_plan_without_executing()
    {
        var h = CreateHarness();
        var existing = await SeedCollectionAsync(h, "Old Name");

        h.Llm
            .CallsTool("library_list_collections")
            .CallsTool("library_create_collection", """{"name":"Fiction"}""")
            .CallsTool("library_rename_collection", $$"""{"collectionId":"{{existing.Id}}","name":"Classics"}""")
            .Returns("Here is a cleaner structure. Approve it to apply the changes.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "My collections are getting messy. Can you propose something cleaner?",
            Context(surface: "library", route: "/library")));

        response.PendingPlan.Should().NotBeNull();
        response.PendingPlan!.Steps.Select(step => step.Capability).Should().Equal(
            "library_create_collection",
            "library_rename_collection");

        // Inspection and proposal only: nothing was executed before approval.
        await using var db = await h.Factory.CreateDbContextAsync();
        var names = await db.Collections.AsNoTracking().Select(c => c.Name).ToListAsync();
        names.Should().Equal("Old Name");
    }

    [Fact]
    public async Task Approving_a_collections_plan_executes_each_mutation_through_the_library_service()
    {
        var h = CreateHarness();
        var existing = await SeedCollectionAsync(h, "Old Name");

        h.Llm
            .CallsTool("library_list_collections")
            .CallsTool("library_create_collection", """{"name":"Fiction"}""")
            .CallsTool("library_rename_collection", $$"""{"collectionId":"{{existing.Id}}","name":"Classics"}""")
            .Returns("Proposed.");

        var turn = await h.Orchestrator.HandleTurnAsync(Turn(
            "Tidy my collections.",
            Context(surface: "library", route: "/library")));

        var plan = turn.PendingPlan!;
        var approved = await h.Orchestrator.ApproveAsync(plan.PlanId, plan.ApprovalToken);

        approved.Success.Should().BeTrue();
        approved.Steps.Should().HaveCount(2);
        approved.Steps.Should().OnlyContain(step => step.Success);

        await using var db = await h.Factory.CreateDbContextAsync();
        var names = await db.Collections.AsNoTracking()
            .Select(c => c.Name)
            .OrderBy(name => name)
            .ToListAsync();
        names.Should().Equal("Classics", "Fiction");
    }

    // ------------------------------------------------------------------
    // PlanAndAct — no mutation until approval
    // ------------------------------------------------------------------

    [Fact]
    public async Task PlanAndAct_intent_produces_a_pending_plan_and_mutates_nothing()
    {
        var h = CreateHarness();
        await SeedBookAsync(h);

        h.Llm
            .CallsTool("library_create_collection", """{"name":"Planned Collection"}""")
            .Returns("I can create that collection if you approve.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Please tidy up my collections.",
            Context(surface: "library", route: "/library")));

        response.PendingPlan.Should().NotBeNull();
        response.PendingPlan!.Steps.Should().ContainSingle()
            .Which.Capability.Should().Be("library_create_collection");
        response.PendingPlan.ApprovalToken.Should().NotBeNullOrWhiteSpace();

        (await CollectionCountAsync(h)).Should().Be(0);
        h.Plans.GetCurrent("client-1").Should().NotBeNull();
    }

    [Fact]
    public async Task Approving_the_matching_plan_executes_exactly_once()
    {
        var h = CreateHarness();
        await SeedBookAsync(h);
        var plan = await CreatePlanAsync(h);

        var approved = await h.Orchestrator.ApproveAsync(plan.PlanId, plan.ApprovalToken);

        approved.Success.Should().BeTrue();
        (await CollectionCountAsync(h)).Should().Be(1);

        // The same plan id + token is consumed: a replay is refused and adds nothing.
        var replay = await h.Orchestrator.ApproveAsync(plan.PlanId, plan.ApprovalToken);
        replay.Success.Should().BeFalse();
        replay.ErrorCode.Should().Be(AssistantErrorCodes.NotFound);
        (await CollectionCountAsync(h)).Should().Be(1);
    }

    [Fact]
    public async Task Approving_with_a_mismatched_id_or_a_missing_or_garbage_token_is_refused()
    {
        var h = CreateHarness();
        await SeedBookAsync(h);
        var plan = await CreatePlanAsync(h);

        var wrongId = await h.Orchestrator.ApproveAsync("not-this-plan", plan.ApprovalToken);
        wrongId.Success.Should().BeFalse();
        wrongId.ErrorCode.Should().Be(AssistantErrorCodes.NotFound);

        var garbageToken = await h.Orchestrator.ApproveAsync(plan.PlanId, "garbage-token");
        garbageToken.Success.Should().BeFalse();
        garbageToken.ErrorCode.Should().Be(AssistantErrorCodes.ApprovalPlanMismatch);

        var missingToken = await h.Orchestrator.ApproveAsync(plan.PlanId, null);
        missingToken.Success.Should().BeFalse();
        missingToken.ErrorCode.Should().Be(AssistantErrorCodes.ApprovalRequired);

        (await CollectionCountAsync(h)).Should().Be(0);
        h.Plans.GetCurrent("client-1").Should().NotBeNull();
    }

    [Fact]
    public async Task A_second_pending_plan_supersedes_the_first_and_a_stale_approval_is_refused()
    {
        var h = CreateHarness();
        await SeedBookAsync(h);

        h.Llm
            .CallsTool("library_create_collection", """{"name":"Plan A"}""")
            .Returns("Plan A is ready.")
            .CallsTool("library_create_collection", """{"name":"Plan B"}""")
            .Returns("Plan B is ready.");

        var first = await h.Orchestrator.HandleTurnAsync(Turn(
            "Tidy up.", Context(surface: "library", route: "/library")));
        var second = await h.Orchestrator.HandleTurnAsync(Turn(
            "Actually, propose something else.", Context(surface: "library", route: "/library")));

        var planA = first.PendingPlan!;
        var planB = second.PendingPlan!;
        planA.PlanId.Should().NotBe(planB.PlanId);

        // The first plan is no longer the conversation's single pending plan.
        // Its id may still be remembered as "superseded" or already gone; either
        // way it is refused and mutates nothing.
        var stale = await h.Orchestrator.ApproveAsync(planA.PlanId, planA.ApprovalToken);
        stale.Success.Should().BeFalse();
        stale.ErrorCode.Should().BeOneOf(
            AssistantErrorCodes.ApprovalPlanMismatch,
            AssistantErrorCodes.NotFound);
        (await CollectionCountAsync(h)).Should().Be(0);

        var current = await h.Orchestrator.ApproveAsync(planB.PlanId, planB.ApprovalToken);
        current.Success.Should().BeTrue();

        await using var db = await h.Factory.CreateDbContextAsync();
        var names = await db.Collections.AsNoTracking().Select(c => c.Name).ToListAsync();
        names.Should().Equal("Plan B");
    }

    // ------------------------------------------------------------------
    // Anchor follow-up — deterministic
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_physical_book_asks_for_a_page_and_skipping_still_captures_as_unknown()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);

        h.Llm
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"A thought"}""")
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"A thought"}""")
            .Returns("Saved.");

        var unanswered = await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this.",
            Context(
                bookId: book.Id.ToString(),
                bookFormat: "physical")));

        unanswered.AnchorPrompt.Should().NotBeNull();
        unanswered.AnchorPrompt!.Kind.Should().Be("physical_page");
        unanswered.AnchorPrompt.Question.Should().Be("What page are you on?");
        (await NoteCountAsync(h)).Should().Be(0);

        // "I don't know" arrives as an explicit unknown anchor on the next turn.
        var skipped = await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this.",
            Context(
                bookId: book.Id.ToString(),
                bookFormat: "physical",
                anchor: new AssistantAnchorDto("unknown", null, false))));

        skipped.AnchorPrompt.Should().BeNull();
        (await NoteCountAsync(h)).Should().Be(1);

        await using var db = await h.Factory.CreateDbContextAsync();
        var note = await db.Notes.AsNoTracking().SingleAsync();
        note.SourceAnchorKind.Should().Be("unknown");
        note.AnchorVerified.Should().BeFalse();
    }

    [Fact]
    public async Task An_answered_page_anchor_is_stored_unverified()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);

        h.Llm
            .CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"A thought"}""")
            .Returns("Saved.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this.",
            Context(
                bookId: book.Id.ToString(),
                bookFormat: "physical",
                anchor: new AssistantAnchorDto("physical_page", "183", false))));

        response.AnchorPrompt.Should().BeNull();

        await using var db = await h.Factory.CreateDbContextAsync();
        var note = await db.Notes.AsNoTracking().SingleAsync();
        note.SourceAnchorKind.Should().Be("physical_page");
        note.SourceAnchorValue.Should().Be("183");
        note.AnchorVerified.Should().BeFalse();
    }

    [Fact]
    public async Task An_externally_played_audiobook_asks_for_a_timestamp()
    {
        var h = CreateHarness();
        var book = await SeedBookAsync(h);

        h.Llm.CallsTool("notes_capture", $$"""{"bookId":"{{book.Id}}","content":"A thought"}""");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Remember this.",
            Context(
                bookId: book.Id.ToString(),
                bookFormat: "audiobook",
                readerType: null)));

        response.AnchorPrompt.Should().NotBeNull();
        response.AnchorPrompt!.Kind.Should().Be("external_audio_timestamp");
        response.AnchorPrompt.Question.Should().Be("What's the current timestamp?");
        (await NoteCountAsync(h)).Should().Be(0);
    }

    // ------------------------------------------------------------------
    // Safety rails
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_tool_iteration_ceiling_is_enforced_and_never_loops_forever()
    {
        var h = CreateHarness(maxToolIterations: 3);

        // A model that never stops asking for tools.
        h.Llm.Responder = _ => new LlmCompletion(
            null,
            "tool_calls",
            [new LlmToolCall(Guid.NewGuid().ToString("N"), "concepts_list", "{}")]);

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Loop, please.",
            Context(surface: "second-brain", route: "/second-brain")));

        response.Should().NotBeNull();
        h.Llm.CallCount.Should().Be(3);
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private Harness CreateHarness(int maxToolIterations = 6)
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
        var db = new NostosDbContext(options);

        var concepts = new ConceptRepository(db);
        var noteService = new NoteService(
            new NoteRepository(db),
            new BookRepository(db),
            concepts,
            new NoteProcessorService(concepts),
            new FakeThoughtProcessor(),
            db,
            NullLogger<NoteService>.Instance);

        var libraryService = new LibraryService(
            factory,
            new BookLookupService(new NoopHttpClientFactory(), new SilentLogger<BookLookupService>()));

        var registry = new AssistantCapabilityRegistry(
            AssistantCapabilities.Build(noteService, libraryService, concepts));

        var llm = new FakeLlmProvider();
        var assistantOptions = new AssistantOptions
        {
            Enabled = true,
            MaxToolIterations = maxToolIterations,
        };
        var plans = new AssistantPlanStore();

        var orchestrator = new AssistantOrchestrator(
            registry,
            llm,
            plans,
            assistantOptions,
            NullLogger<AssistantOrchestrator>.Instance);

        return new Harness(db, factory, registry, llm, plans, orchestrator);
    }

    private static async Task<AssistantPendingPlanDto> CreatePlanAsync(Harness h)
    {
        h.Llm
            .CallsTool("library_create_collection", """{"name":"Approved Collection"}""")
            .Returns("Ready for your approval.");

        var response = await h.Orchestrator.HandleTurnAsync(Turn(
            "Please tidy up.",
            Context(surface: "library", route: "/library")));

        return response.PendingPlan!;
    }

    private static AssistantTurnRequest Turn(
        string message,
        AssistantContextDto context,
        string clientId = "client-1",
        string idem = "key-1",
        string? pendingPlanId = null) =>
        new(clientId, idem, message, context, pendingPlanId);

    private static AssistantContextDto Context(
        string surface = "second-brain",
        string route = "/second-brain",
        string? bookId = null,
        string? bookTitle = null,
        string? bookFormat = null,
        string? readerType = null,
        string? epubCfi = null,
        int? pdfPage = null,
        double? audioTimestamp = null,
        string? selectedText = null,
        string? brainReviewNoteId = null,
        AssistantAnchorDto? anchor = null) =>
        new(
            surface,
            route,
            bookId,
            bookTitle,
            bookFormat,
            readerType,
            epubCfi,
            pdfPage,
            audioTimestamp,
            AudioChapter: null,
            selectedText,
            BrainReviewNoteId: brainReviewNoteId,
            Concept: null,
            CollectionId: null,
            anchor);

    private static async Task<PhysicalBookModel> SeedBookAsync(
        Harness h, string title = "Seeded Book")
    {
        var book = new PhysicalBookModel { Id = Guid.NewGuid(), Title = title, Author = "Author" };
        h.Db.Books.Add(book);
        await h.Db.SaveChangesAsync();
        return book;
    }

    private static async Task<NoteModel> SeedNoteAsync(Harness h, Guid bookId, string content)
    {
        var note = new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = bookId,
            Content = content,
            CreatedAt = DateTime.UtcNow,
        };
        h.Db.Notes.Add(note);
        await h.Db.SaveChangesAsync();
        return note;
    }

    private static async Task<ConceptModel> SeedConceptAsync(Harness h, string name)
    {
        var concept = new ConceptModel { Id = Guid.NewGuid(), Concept = name };
        h.Db.Concepts.Add(concept);
        await h.Db.SaveChangesAsync();
        return concept;
    }

    private static async Task<CollectionModel> SeedCollectionAsync(Harness h, string name)
    {
        var collection = new CollectionModel { Id = Guid.NewGuid(), Name = name };
        h.Db.Collections.Add(collection);
        await h.Db.SaveChangesAsync();
        return collection;
    }

    private static async Task<int> NoteCountAsync(Harness h)
    {
        await using var db = await h.Factory.CreateDbContextAsync();
        return await db.Notes.CountAsync();
    }

    private static async Task<int> CollectionCountAsync(Harness h)
    {
        await using var db = await h.Factory.CreateDbContextAsync();
        return await db.Collections.CountAsync();
    }

    private static async Task<StoreSnapshot> StoreSnapshotAsync(Harness h)
    {
        await using var db = await h.Factory.CreateDbContextAsync();

        var notes = await db.Notes.AsNoTracking()
            .OrderBy(n => n.Id)
            .Select(n => new { n.Id, n.Content })
            .ToListAsync();
        var concepts = await db.Concepts.AsNoTracking()
            .OrderBy(c => c.Id)
            .Select(c => new { c.Id, c.Concept })
            .ToListAsync();
        var collections = await db.Collections.AsNoTracking()
            .OrderBy(c => c.Id)
            .Select(c => new { c.Id, c.Name, c.ParentId })
            .ToListAsync();

        return new StoreSnapshot(
            notes.Select(n => $"{n.Id}:{n.Content}").ToList(),
            concepts.Select(c => $"{c.Id}:{c.Concept}").ToList(),
            collections.Select(c => $"{c.Id}:{c.Name}:{c.ParentId}").ToList());
    }

    private sealed record StoreSnapshot(
        IReadOnlyList<string> Notes,
        IReadOnlyList<string> Concepts,
        IReadOnlyList<string> Collections);

    private sealed class Harness(
        NostosDbContext db,
        IDbContextFactory<NostosDbContext> factory,
        AssistantCapabilityRegistry registry,
        FakeLlmProvider llm,
        AssistantPlanStore plans,
        AssistantOrchestrator orchestrator) : IDisposable
    {
        public NostosDbContext Db { get; } = db;
        public IDbContextFactory<NostosDbContext> Factory { get; } = factory;
        public AssistantCapabilityRegistry Registry { get; } = registry;
        public FakeLlmProvider Llm { get; } = llm;
        public AssistantPlanStore Plans { get; } = plans;
        public AssistantOrchestrator Orchestrator { get; } = orchestrator;

        public void Dispose() => Db.Dispose();
    }

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options)
        : IDbContextFactory<NostosDbContext>
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

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
        }
    }
}
