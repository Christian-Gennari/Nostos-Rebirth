using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 5 canonical REST surface (/api/reading/*, frozen plan lines 289-314)
// with /api/reading-training/* kept as a backward-compatible alias. Every
// canonical route must behave identically through both prefixes; the alias
// group additionally keeps the legacy route shapes that predate the
// canonical contract. Task 17 deploys and verifies the canonical
// /api/reading/dashboard URL live.
public sealed class ReadingTrainingCanonicalRoutesTests
{
    private const string Canonical = "/api/reading";
    private const string Alias = "/api/reading-training";
    private const string ClientId = "canonical-test";

    [Fact]
    public async Task Task17DashboardUrl_IsServed_AndIdenticalThroughBothPrefixes()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        // Task 17 verifies exactly this URL on the production port.
        var canonical = await client.GetAsync($"{Canonical}/dashboard");
        canonical.StatusCode.Should().Be(HttpStatusCode.OK);
        var canonicalEnvelope = await Envelope(canonical);
        canonicalEnvelope.GetProperty("data").GetProperty("programme").ValueKind.Should().Be(JsonValueKind.Object);

        var alias = await client.GetAsync($"{Alias}/dashboard");
        alias.StatusCode.Should().Be(HttpStatusCode.OK);
        var aliasEnvelope = await Envelope(alias);

        // Identical envelope through both prefixes: same reply, same state
        // version, byte-identical data payload.
        canonicalEnvelope.GetProperty("reply").GetString().Should().Be(aliasEnvelope.GetProperty("reply").GetString());
        canonicalEnvelope.GetProperty("stateVersion").GetString()
            .Should().Be(aliasEnvelope.GetProperty("stateVersion").GetString());
        canonicalEnvelope.GetProperty("data").GetRawText().Should().Be(aliasEnvelope.GetProperty("data").GetRawText());
    }

    [Fact]
    public async Task Mutation_ThroughOnePrefix_ReplayedThroughOther_IsExactOnce()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBookAsync(factory, "Candide");

        // First mutation through the canonical prefix...
        var add = new ReadingAddBookAssignmentRequest(
            ClientId, "dual-prefix-add", bookId, ReadingMode.Endurance, MakeDefault: true);
        var first = await Envelope(await client.PostAsJsonAsync($"{Canonical}/books", add));
        first.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var assignmentId = first.GetProperty("data").GetProperty("id").GetGuid();

        // ...replayed through the alias prefix with the same idempotency
        // key: stored original result, duplicate=true, exactly one row.
        var replay = await Envelope(await client.PostAsJsonAsync($"{Alias}/books", add));
        replay.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        replay.GetProperty("data").GetProperty("id").GetGuid().Should().Be(assignmentId);
        replay.GetProperty("stateVersion").GetString()
            .Should().Be(first.GetProperty("stateVersion").GetString());
        replay.GetProperty("reply").GetString().Should().Be(first.GetProperty("reply").GetString());

        var books = await Envelope(await client.GetAsync($"{Canonical}/books"));
        books.GetProperty("data").EnumerateArray()
            .Should().ContainSingle(x => x.GetProperty("id").GetGuid() == assignmentId);

        // Reverse direction: first through the alias, replay through the
        // canonical prefix — receipts are transport-agnostic.
        var addDeep = new ReadingAddBookAssignmentRequest(
            ClientId, "dual-prefix-add-2", bookId, ReadingMode.Deep);
        var revFirst = await Envelope(await client.PostAsJsonAsync($"{Alias}/books", addDeep));
        revFirst.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var revReplay = await Envelope(await client.PostAsJsonAsync($"{Canonical}/books", addDeep));
        revReplay.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        revReplay.GetProperty("data").GetProperty("id").GetGuid()
            .Should().Be(revFirst.GetProperty("data").GetProperty("id").GetGuid());
        revReplay.GetProperty("reply").GetString().Should().Be(revFirst.GetProperty("reply").GetString());
    }

    [Fact]
    public async Task CanonicalSurface_IsMapped_OnBothPrefixes_Not404Or405()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        var unknownId = Guid.Parse("99999999-9999-9999-9999-999999999999");

        // With an uninitialized programme every service-touching route
        // answers through the stable envelope. Some mapped commands may
        // legitimately return semantic 404s (missing assignment/session), so
        // distinguish those JSON responses from the SPA shell rather than
        // treating every 404 as an unmapped endpoint.
        var cases = new (HttpMethod Method, string Path, object? Body)[]
        {
            (HttpMethod.Post, "/initialize", new ReadingCommandRequest(ClientId, "map-init")),
            (HttpMethod.Get, "/dashboard", null),
            (HttpMethod.Get, "/status", null),
            (HttpMethod.Get, "/week?week=2026-W32", null),
            (HttpMethod.Get, "/sessions", null),
            (HttpMethod.Post, "/sessions/plan",
                new ReadingPlanSessionRequest(ClientId, "map-plan", Guid.NewGuid(), ReadingMode.Endurance, 30)),
            (HttpMethod.Post, "/sessions/start", new ReadingStartSessionRequest(ClientId, "map-start")),
            (HttpMethod.Post, "/sessions/start-new", new ReadingStartNewSessionRequest(ClientId, "map-start-new")),
            (HttpMethod.Post, $"/sessions/{unknownId}/pause", new ReadingSessionCommandRequest(ClientId, "map-pause")),
            (HttpMethod.Post, $"/sessions/{unknownId}/resume", new ReadingSessionCommandRequest(ClientId, "map-resume")),
            (HttpMethod.Post, $"/sessions/{unknownId}/complete",
                new ReadingCompleteSessionRequest(ClientId, "map-complete", ReportedMinutes: 30)),
            (HttpMethod.Post, $"/sessions/{unknownId}/rate",
                new ReadingRateSessionRequest(ClientId, "map-rate", 5, 5)),
            (HttpMethod.Post, $"/sessions/{unknownId}/skip-ratings",
                new ReadingSkipRatingsRequest(ClientId, "map-skip")),
            (HttpMethod.Delete, $"/sessions/{unknownId}/open",
                new ReadingSessionCommandRequest(ClientId, "map-cancel")),
            (HttpMethod.Get, "/books", null),
            (HttpMethod.Post, "/books",
                new ReadingAddBookAssignmentRequest(ClientId, "map-books", Guid.NewGuid(), ReadingMode.Endurance)),
            (HttpMethod.Patch, $"/books/{unknownId}",
                new ReadingUpdateBookAssignmentRequest(ClientId, "map-patch-book", ReadingMode.Endurance)),
            (HttpMethod.Post, $"/books/{unknownId}/finish",
                new ReadingCompleteBookRequest(ClientId, "map-finish-book", Guid.NewGuid())),
            (HttpMethod.Get, "/inbox", null),
            (HttpMethod.Post, "/captures",
                new ReadingCaptureRequest(ClientId, "map-capture", "text", ReadingCaptureType.Thought)),
            (HttpMethod.Patch, $"/captures/{unknownId}",
                new ReadingResolveCaptureRequest(ClientId, "map-resolve", Keep: false)),
            (HttpMethod.Post, $"/captures/{unknownId}/promote-to-note",
                new ReadingPromoteCaptureRequest(ClientId, "map-promote", Guid.NewGuid())),
            (HttpMethod.Post, "/reviews/preview", new ReadingWeeklyReviewRequest(2026, 32)),
            (HttpMethod.Post, "/reviews/commit",
                new ReadingCommitWeeklyReviewRequest(ClientId, "map-commit", 2026, 32)),
            (HttpMethod.Post, "/gateway/dispatch",
                new ReadingGatewayDispatchRequest(ClientId, "map-gateway", "status")),
            (HttpMethod.Get, "/notifications/lease?maxCount=10&leaseSeconds=60", null),
            (HttpMethod.Post, $"/notifications/{unknownId}/ack", null),
        };

        foreach (var prefix in new[] { Canonical, Alias })
        {
            foreach (var (method, path, body) in cases)
            {
                using var request = new HttpRequestMessage(method, prefix + path);
                if (body is not null)
                {
                    request.Content = JsonContent.Create(body);
                }
                var response = await client.SendAsync(request);
                var label = $"{method} {prefix}{path}";
                response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed, label);
                var content = await response.Content.ReadAsStringAsync();
                content.Should().NotContain(ReadingTrainingHttpFactory.SpaShellMarker, label);
                if (response.StatusCode == HttpStatusCode.NotFound)
                {
                    response.Content.Headers.ContentType?.MediaType.Should().Contain("json", label);
                    content.Should().NotBeNullOrWhiteSpace(label);
                }
            }
        }
    }

    [Fact]
    public async Task CanonicalReadAndBookSurfaces_WorkAfterInitialize()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBookAsync(factory, "Meditations");

        // GET /books: empty queue before any assignment.
        var empty = await Envelope(await client.GetAsync($"{Canonical}/books"));
        empty.GetProperty("data").EnumerateArray().Should().BeEmpty();

        var add = await Envelope(await client.PostAsJsonAsync($"{Canonical}/books",
            new ReadingAddBookAssignmentRequest(ClientId, "books-1", bookId, ReadingMode.Endurance)));
        var assignmentId = add.GetProperty("data").GetProperty("id").GetGuid();

        var listed = await Envelope(await client.GetAsync($"{Canonical}/books"));
        var listedDto = listed.GetProperty("data").EnumerateArray().Should().ContainSingle().Subject;
        listedDto.GetProperty("id").GetGuid().Should().Be(assignmentId);
        listedDto.GetProperty("isDefault").GetBoolean().Should().BeFalse();

        // PATCH /books/{assignmentId}: canonical set-default expression.
        var patched = await Envelope(await client.PatchAsJsonAsync($"{Canonical}/books/{assignmentId}",
            new ReadingUpdateBookAssignmentRequest(ClientId, "books-patch", ReadingMode.Endurance)));
        patched.GetProperty("data").GetProperty("id").GetGuid().Should().Be(assignmentId);
        patched.GetProperty("data").GetProperty("isDefault").GetBoolean().Should().BeTrue();

        // POST /books/{assignmentId}/finish: canonical finish expression.
        var finished = await Envelope(await client.PostAsJsonAsync($"{Canonical}/books/{assignmentId}/finish",
            new ReadingCompleteBookRequest(ClientId, "books-finish", assignmentId)));
        finished.GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingAssignmentStatus.Completed);

        // GET /week: canonical ISO-week preview, including the parse guard.
        var week = await Envelope(await client.GetAsync($"{Canonical}/week?week=2026-W32"));
        week.GetProperty("data").GetProperty("weekKey").GetString().Should().Be("2026-W32");
        week.GetProperty("data").GetProperty("committed").GetBoolean().Should().BeFalse();

        var badWeek = await client.GetAsync($"{Canonical}/week?week=2026-32");
        badWeek.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        badWeek.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");

        // POST /reviews/preview carries year/week in the body.
        var preview = await Envelope(await client.PostAsJsonAsync($"{Canonical}/reviews/preview",
            new ReadingWeeklyReviewRequest(2026, 32)));
        preview.GetProperty("data").GetProperty("weekKey").GetString().Should().Be("2026-W32");

        // GET /sessions: history with the canonical filters.
        var history = await Envelope(await client.GetAsync($"{Canonical}/sessions"));
        history.GetProperty("data").EnumerateArray().Should().BeEmpty();
        var filtered = await Envelope(await client.GetAsync($"{Canonical}/sessions?mode=Endurance"));
        filtered.GetProperty("data").EnumerateArray().Should().BeEmpty();
    }

    [Fact]
    public async Task CanonicalSessionLifecycle_WithPathIds_AndWrongIdGuard()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBookAsync(factory, "Candide");

        var add = await Envelope(await client.PostAsJsonAsync($"{Canonical}/books",
            new ReadingAddBookAssignmentRequest(ClientId, "life-add", bookId, ReadingMode.Endurance, MakeDefault: true)));
        var assignmentId = add.GetProperty("data").GetProperty("id").GetGuid();

        var plan = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/plan",
            new ReadingPlanSessionRequest(ClientId, "life-plan", assignmentId, ReadingMode.Endurance, 40)));
        var sessionId = plan.GetProperty("data").GetProperty("id").GetGuid();
        plan.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Planned);

        var start = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/start",
            new ReadingStartSessionRequest(ClientId, "life-start")));
        start.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Active);

        // A path id that does not name the open session is rejected with
        // ProblemDetails before any mutation: the session stays Active.
        var wrongId = Guid.Parse("88888888-8888-8888-8888-888888888888");
        var wrongPause = await client.PostAsJsonAsync($"{Canonical}/sessions/{wrongId}/pause",
            new ReadingSessionCommandRequest(ClientId, "life-wrong-pause"));
        wrongPause.StatusCode.Should().Be(HttpStatusCode.NotFound);
        wrongPause.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        var wrongProblem = await Envelope(wrongPause);
        wrongProblem.GetProperty("title").GetString().Should().Be("Session not found.");

        var stillActive = await Envelope(await client.GetAsync($"{Canonical}/status"));
        stillActive.GetProperty("data").GetProperty("id").GetGuid().Should().Be(sessionId);
        stillActive.GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.Active);

        // Path-id commands drive the lifecycle.
        var pause = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/{sessionId}/pause",
            new ReadingSessionCommandRequest(ClientId, "life-pause")));
        pause.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Paused);

        var resume = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/{sessionId}/resume",
            new ReadingSessionCommandRequest(ClientId, "life-resume")));
        resume.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Active);

        var complete = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/{sessionId}/complete",
            new ReadingCompleteSessionRequest(ClientId, "life-complete", ReportedMinutes: 25)));
        complete.GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.AwaitingFeedback);

        var rate = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/{sessionId}/rate",
            new ReadingRateSessionRequest(ClientId, "life-rate", Effort: 6, Focus: 7, Rating: 4)));
        rate.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Completed);

        // DELETE /sessions/{id}/open is the canonical cancel expression.
        var startNew = await Envelope(await client.PostAsJsonAsync($"{Canonical}/sessions/start-new",
            new ReadingStartNewSessionRequest(ClientId, "life-start-new")));
        var secondId = startNew.GetProperty("data").GetProperty("id").GetGuid();

        var cancelled = await Envelope(await client.SendAsync(new HttpRequestMessage(
            HttpMethod.Delete, $"{Canonical}/sessions/{secondId}/open")
        {
            Content = JsonContent.Create(new ReadingSessionCommandRequest(ClientId, "life-cancel")),
        }));
        cancelled.GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.Cancelled);

        // Canonical history lists both sessions, and the mode filter works.
        var history = await Envelope(await client.GetAsync($"{Canonical}/sessions?mode=Endurance"));
        history.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid())
            .Should().BeEquivalentTo(new[] { sessionId, secondId });
        var deepHistory = await Envelope(await client.GetAsync($"{Canonical}/sessions?mode=Deep"));
        deepHistory.GetProperty("data").EnumerateArray().Should().BeEmpty();
    }

    [Fact]
    public async Task CanonicalCaptureSurface_ResolveAndPromote_Work()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBookAsync(factory, "Enchiridion");

        var capture = await Envelope(await client.PostAsJsonAsync($"{Canonical}/captures",
            new ReadingCaptureRequest(ClientId, "cap-1", "What is in our power?",
                ReadingCaptureType.Question, BookId: bookId)));
        var captureId = capture.GetProperty("data").GetProperty("id").GetGuid();

        var inbox = await Envelope(await client.GetAsync($"{Canonical}/inbox"));
        inbox.GetProperty("data").EnumerateArray().Select(x => x.GetProperty("id").GetGuid())
            .Should().Contain(captureId);

        // PATCH /captures/{id} is the canonical resolve expression.
        var resolved = await Envelope(await client.PatchAsJsonAsync($"{Canonical}/captures/{captureId}",
            new ReadingResolveCaptureRequest(ClientId, "cap-resolve", Keep: false)));
        resolved.GetProperty("data").GetProperty("resolved").GetBoolean().Should().BeTrue();
        resolved.GetProperty("data").GetProperty("promotedNoteId").ValueKind.Should().Be(JsonValueKind.Null);

        var inboxAfter = await Envelope(await client.GetAsync($"{Canonical}/inbox"));
        inboxAfter.GetProperty("data").EnumerateArray().Select(x => x.GetProperty("id").GetGuid())
            .Should().NotContain(captureId);

        // Promote into an existing note (canonical path shape).
        var second = await Envelope(await client.PostAsJsonAsync($"{Canonical}/captures",
            new ReadingCaptureRequest(ClientId, "cap-2", "Hold to the course.",
                ReadingCaptureType.Thought, BookId: bookId)));
        var secondId = second.GetProperty("data").GetProperty("id").GetGuid();

        Guid noteId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var note = new NoteModel { BookId = bookId, Content = "Existing note." };
            db.Notes.Add(note);
            await db.SaveChangesAsync();
            noteId = note.Id;
        }

        var promoted = await Envelope(await client.PostAsJsonAsync(
            $"{Canonical}/captures/{secondId}/promote-to-note",
            new ReadingPromoteCaptureRequest(ClientId, "cap-promote", noteId)));
        promoted.GetProperty("data").GetProperty("resolved").GetBoolean().Should().BeTrue();
        promoted.GetProperty("data").GetProperty("promotedNoteId").GetGuid().Should().Be(noteId);
    }

    private static Task<HttpResponseMessage> InitializeAsync(
        HttpClient client, string key = "canonical-init-1") =>
        client.PostAsJsonAsync(
            $"{Canonical}/initialize",
            new ReadingCommandRequest(ClientId, key));

    private static async Task<JsonElement> Envelope(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static async Task<Guid> SeedBookAsync(ReadingTrainingHttpFactory factory, string title)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
        var book = new PhysicalBookModel { Title = title, Author = "Test Author" };
        db.PhysicalBooks.Add(book);
        await db.SaveChangesAsync();
        return book.Id;
    }
}
