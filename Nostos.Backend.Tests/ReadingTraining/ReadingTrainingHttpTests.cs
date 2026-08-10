using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Workers;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Real HTTP integration host for the Reading Training REST foundation
// (Task 5A): the full Nostos.Backend Program (top-level statements, DI,
// middleware, OpenAPI) runs on a TestServer backed by a real temporary-file
// SQLite database, so routing, DI lifetime, and persistence are exercised
// end-to-end instead of through unit-test mocks.
public sealed class ReadingTrainingHttpFactory : WebApplicationFactory<Program>
{
    // Marker embedded in the guaranteed test SPA shell. The factory hosts
    // its own temporary web root so the SPA-fallback behavior under test
    // is independent of any Release build artifact in
    // Nostos.Backend/wwwroot: client routes always serve this shell and
    // API/MCP boundaries must never return it.
    public const string SpaShellMarker = "nostos-test-spa-shell";

    private readonly string _dbPath;
    private readonly string _webRootPath;

    public ReadingTrainingHttpFactory()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"nostos-reading-http-{Guid.NewGuid():N}.db");
        ReadingTrainingHttpBootstrap.EnsureSchemaAndHistory(_dbPath);
        _webRootPath = CreateSpaShellWebRoot();
    }

    public string DatabasePath => _dbPath;

    // True when production DI (Program.cs) registered the reading
    // notification scanner worker before the test host strips every hosted
    // service — proves the production registration exists without ever
    // starting the worker inside the test host.
    public bool ReadingNotificationWorkerRegistered { get; private set; }

    // Private web root containing a minimal index.html, so the SPA
    // fallback is exercised deterministically (isolation versus shell
    // serving) regardless of whether a Release build populated
    // Nostos.Backend/wwwroot.
    private static string CreateSpaShellWebRoot()
    {
        var webRoot = Path.Combine(Path.GetTempPath(), $"nostos-http-webroot-{Guid.NewGuid():N}");
        Directory.CreateDirectory(webRoot);
        File.WriteAllText(
            Path.Combine(webRoot, "index.html"),
            $"<!doctype html><html><head><title>nostos test shell</title></head><body>{SpaShellMarker}</body></html>");
        return webRoot;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseWebRoot(_webRootPath);

        builder.ConfigureServices(services =>
        {
            // Capture the production hosted-service registration before the
            // test host removes all hosted services.
            ReadingNotificationWorkerRegistered = services.Any(d =>
                d.ServiceType == typeof(IHostedService) &&
                d.ImplementationType == typeof(ReadingNotificationWorker));

            // Replace the production SQLite registration: both the scoped
            // NostosDbContext and the IDbContextFactory<NostosDbContext> must
            // resolve against the same temporary file. The options are
            // registered once with singleton lifetime, exactly like Program.cs,
            // so both surface types share one options instance.
            services.RemoveAll<DbContextOptions>();
            services.RemoveAll<DbContextOptions<NostosDbContext>>();
            services.RemoveAll<NostosDbContext>();
            services.RemoveAll<IDbContextFactory<NostosDbContext>>();

            // Disable the production hosted workers (concept cleanup, backup
            // poller and the reading notification scanner) so they cannot race
            // the temporary database in tests; HTTP tests stay deterministic.
            services.RemoveAll<IHostedService>();

            services.AddDbContext<NostosDbContext>(
                options => options.UseSqlite($"Data Source={_dbPath}"),
                ServiceLifetime.Scoped,
                ServiceLifetime.Singleton);
            services.AddDbContextFactory<NostosDbContext>(
                options => options.UseSqlite($"Data Source={_dbPath}"));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing)
        {
            return;
        }

        foreach (var suffix in new[] { "", "-shm", "-wal" })
        {
            try
            {
                File.Delete(_dbPath + suffix);
            }
            catch (IOException)
            {
                // Best-effort cleanup only.
            }
        }

        try
        {
            Directory.Delete(_webRootPath, recursive: true);
        }
        catch (IOException)
        {
            // Best-effort cleanup only.
        }
    }
}

internal static class ReadingTrainingHttpBootstrap
{
    // This repository's migration chain has no initial baseline migration (the
    // first migration ALTERs tables created before migrations existed), so a
    // fresh database cannot be bootstrapped with Migrate(). Create the full
    // model schema with EnsureCreated, then mark every migration as applied so
    // Program's startup Migrate() call becomes a no-op.
    public static void EnsureSchemaAndHistory(string dbPath)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={dbPath}")
            .Options;
        using var db = new NostosDbContext(options);
        db.Database.EnsureCreated();
        db.Database.ExecuteSqlRaw(
            "CREATE TABLE IF NOT EXISTS __EFMigrationsHistory (" +
            "MigrationId TEXT NOT NULL, ProductVersion TEXT NOT NULL, PRIMARY KEY (MigrationId))");
        foreach (var migrationId in db.Database.GetMigrations())
        {
            db.Database.ExecuteSqlRaw(
                "INSERT OR IGNORE INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES ({0}, {1})",
                migrationId, "10.0.0");
        }
    }
}

public sealed class ReadingTrainingHttpTests
{
    [Fact]
    public async Task AllRoutesExist_AndNotInitializedMappingsApply()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        var dashboard = await client.GetAsync("/api/reading-training/dashboard");
        dashboard.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(dashboard)).Should().Be("not_initialized");

        var preview = await client.GetAsync("/api/reading-training/weekly-reviews/2026/32/preview");
        preview.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(preview)).Should().Be("not_initialized");

        var status = await client.GetAsync("/api/reading-training/status");
        status.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(status)).GetProperty("data").ValueKind.Should().Be(JsonValueKind.Null);

        var history = await client.GetAsync("/api/reading-training/history");
        history.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(history)).GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var inbox = await client.GetAsync("/api/reading-training/inbox");
        inbox.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(inbox)).GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var initialize = await InitializeAsync(client);
        initialize.StatusCode.Should().Be(HttpStatusCode.OK);

        var previewAfterInit = await client.GetAsync("/api/reading-training/weekly-reviews/2026/32/preview");
        previewAfterInit.StatusCode.Should().Be(HttpStatusCode.OK);
        var previewData = (await Envelope(previewAfterInit)).GetProperty("data");
        previewData.GetProperty("weekKey").GetString().Should().Be("2026-W32");
    }

    [Fact]
    public async Task Initialize_IsExactOnce_ForSameIdempotencyKey()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        var first = await InitializeAsync(client, key: "init-1");
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstEnvelope = await Envelope(first);
        firstEnvelope.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        firstEnvelope.GetProperty("reply").GetString().Should().Contain("initialized");
        var firstVersion = firstEnvelope.GetProperty("stateVersion").GetString();
        firstEnvelope.GetProperty("data").GetProperty("timezoneId").GetString().Should().Be("Europe/Stockholm");
        var programmeId = firstEnvelope.GetProperty("data").GetProperty("id").GetGuid();

        var second = await InitializeAsync(client, key: "init-1");
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondEnvelope = await Envelope(second);
        secondEnvelope.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        secondEnvelope.GetProperty("stateVersion").GetString().Should().Be(firstVersion);
        secondEnvelope.GetProperty("data").GetProperty("id").GetGuid().Should().Be(programmeId);
    }

    [Fact]
    public async Task ReadSurfaces_ReturnDeserializableEnvelopes_AfterInitialize()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var dashboard = await Envelope(await client.GetAsync("/api/reading-training/dashboard"));
        var dashData = dashboard.GetProperty("data");
        dashData.GetProperty("programme").GetProperty("id").ValueKind.Should().Be(JsonValueKind.String);
        dashData.GetProperty("books").ValueKind.Should().Be(JsonValueKind.Array);
        dashData.GetProperty("openSession").ValueKind.Should().Be(JsonValueKind.Null);
        // An initialized dashboard always carries a non-null current-week
        // summary; with no sessions it is a zero summary keyed to the real
        // Europe/Stockholm ISO week at the moment of the request.
        var currentWeek = dashData.GetProperty("currentWeek");
        currentWeek.ValueKind.Should().Be(JsonValueKind.Object);
        currentWeek.GetProperty("weekKey").GetString().Should().MatchRegex(@"^\d{4}-W\d{2}$");
        currentWeek.GetProperty("completedSessions").GetInt32().Should().Be(0);
        currentWeek.GetProperty("qualifyingSessions").GetInt32().Should().Be(0);
        currentWeek.GetProperty("volumeMinutes").GetInt32().Should().Be(0);
        currentWeek.GetProperty("completionThreshold").GetDouble()
            .Should().Be(ReadingProgressionPolicy.IncreaseCompletionRate);
        currentWeek.GetProperty("reviewCommitted").GetBoolean().Should().BeFalse();

        var status = await Envelope(await client.GetAsync("/api/reading-training/status"));
        status.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Null);
        status.GetProperty("reply").GetString().Should().Be("No active reading session.");

        var history = await Envelope(await client.GetAsync("/api/reading-training/history"));
        history.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var inbox = await Envelope(await client.GetAsync("/api/reading-training/inbox"));
        inbox.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        var preview = await Envelope(await client.GetAsync("/api/reading-training/weekly-reviews/2026/33/preview"));
        var previewData = preview.GetProperty("data");
        previewData.GetProperty("weekKey").GetString().Should().Be("2026-W33");
        previewData.GetProperty("committed").GetBoolean().Should().BeFalse();
        previewData.GetProperty("modes").ValueKind.Should().Be(JsonValueKind.Array);
        previewData.GetProperty("stateVersion").GetString().Should().Be(
            status.GetProperty("stateVersion").GetString());
    }

    [Fact]
    public async Task InvalidWeek_MapsTo400WithInvalidWeekCode()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var response = await client.GetAsync("/api/reading-training/weekly-reviews/2026/99/preview");
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(response)).Should().Be("invalid_week");

        var yearOutOfRange = await client.GetAsync("/api/reading-training/weekly-reviews/0/1/preview");
        yearOutOfRange.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(yearOutOfRange)).Should().Be("invalid_week");
    }

    [Fact]
    public async Task State_SurvivesSecondClientAndFreshServiceScope()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client1 = factory.CreateClient();
        var init = await Envelope(await InitializeAsync(client1));
        var programmeId = init.GetProperty("data").GetProperty("id").GetGuid();

        // A second HTTP client (new request pipeline, new service scopes) sees
        // the committed state persisted in the shared SQLite file.
        using var client2 = factory.CreateClient();
        var dashboard = await Envelope(await client2.GetAsync("/api/reading-training/dashboard"));
        dashboard.GetProperty("data").GetProperty("programme").GetProperty("id").GetGuid()
            .Should().Be(programmeId);

        // A freshly resolved application service scope sees the same state
        // through the scoped NostosDbContext and the IDbContextFactory.
        using var scope = factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<IReadingTrainingService>();
        var result = await service.GetDashboardAsync();
        ((ReadingDashboardDto)result.Data!).Programme.Id.Should().Be(programmeId);

        var scopedDb = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
        scopedDb.ReadingProgrammes.Count().Should().Be(1);

        await using var factoryDb = await scope.ServiceProvider
            .GetRequiredService<IDbContextFactory<NostosDbContext>>()
            .CreateDbContextAsync();
        factoryDb.ReadingProgrammes.Count().Should().Be(1);
    }

    [Fact]
    public async Task UnrelatedEndpoints_StillRespond_AfterDiRegistrationChanges()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        var settings = await client.GetAsync("/api/backup/settings");
        settings.StatusCode.Should().Be(HttpStatusCode.OK);
        var settingsJson = await settings.Content.ReadAsStringAsync();
        settingsJson.Should().NotBeNullOrEmpty();

        var openApi = await client.GetAsync("/openapi/v1.json");
        openApi.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AllMutationRoutes_AreMapped_AndBodyBound_Not404Or405()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        // Every mutation route must reach the domain service: with an
        // uninitialized programme each returns 409 not_initialized through the
        // stable envelope. A routing miss would give 404/405, a body-binding
        // failure would give 400 — so 409 + envelope code proves both the
        // route mapping and the typed request binding for every route.
        var cases = new (HttpMethod Method, string Path, object Body)[]
        {
            (HttpMethod.Post, "/api/reading-training/books",
                new ReadingAddBookAssignmentRequest("http-test", "map-books", Guid.NewGuid(), ReadingMode.Endurance)),
            (HttpMethod.Post, "/api/reading-training/books/default",
                new ReadingSetDefaultBookRequest("http-test", "map-default", Guid.NewGuid(), ReadingMode.Deep)),
            (HttpMethod.Post, "/api/reading-training/books/complete",
                new ReadingCompleteBookRequest("http-test", "map-complete", Guid.NewGuid())),
            (HttpMethod.Post, "/api/reading-training/books/reorder",
                new ReadingReorderQueueRequest("http-test", "map-reorder", Array.Empty<Guid>())),
            (HttpMethod.Post, "/api/reading-training/sessions/plan",
                new ReadingPlanSessionRequest("http-test", "map-plan", Guid.NewGuid(), ReadingMode.Endurance, 30)),
            (HttpMethod.Post, "/api/reading-training/sessions/start",
                new ReadingStartSessionRequest("http-test", "map-start")),
            (HttpMethod.Post, "/api/reading-training/sessions/start-new",
                new ReadingStartNewSessionRequest("http-test", "map-start-new")),
            (HttpMethod.Post, "/api/reading-training/sessions/pause",
                new ReadingSessionCommandRequest("http-test", "map-pause")),
            (HttpMethod.Post, "/api/reading-training/sessions/resume",
                new ReadingSessionCommandRequest("http-test", "map-resume")),
            (HttpMethod.Post, "/api/reading-training/sessions/complete",
                new ReadingCompleteSessionRequest("http-test", "map-complete-session", ReportedMinutes: 30)),
            (HttpMethod.Post, "/api/reading-training/sessions/rate",
                new ReadingRateSessionRequest("http-test", "map-rate", 5, 5)),
            (HttpMethod.Post, "/api/reading-training/sessions/skip-ratings",
                new ReadingSkipRatingsRequest("http-test", "map-skip")),
            (HttpMethod.Post, "/api/reading-training/sessions/cancel",
                new ReadingSessionCommandRequest("http-test", "map-cancel")),
            (HttpMethod.Post, "/api/reading-training/captures",
                new ReadingCaptureRequest("http-test", "map-capture", "text", ReadingCaptureType.Thought)),
            (HttpMethod.Patch, $"/api/reading-training/captures/{Guid.NewGuid()}/resolve",
                new ReadingResolveCaptureRequest("http-test", "map-resolve", Keep: false)),
            (HttpMethod.Post, $"/api/reading-training/captures/{Guid.NewGuid()}/promote-to-note",
                new ReadingPromoteCaptureRequest("http-test", "map-promote", Guid.NewGuid())),
            (HttpMethod.Post, "/api/reading-training/weekly-reviews/commit",
                new ReadingCommitWeeklyReviewRequest("http-test", "map-commit", 2026, 32)),
        };

        foreach (var (method, path, body) in cases)
        {
            using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
            var response = await client.SendAsync(request);
            response.StatusCode.Should().Be(
                HttpStatusCode.Conflict, $"{method} {path} should reach the domain service");
            var envelope = await Envelope(response);
            envelope.GetProperty("data").GetProperty("code").GetString()
                .Should().Be("not_initialized", $"{method} {path} should return the domain envelope");
            envelope.GetProperty("stateVersion").ValueKind.Should().Be(JsonValueKind.String);
        }
    }

    [Fact]
    public async Task UnmappedPaths_AndWrongMethods_NeverReachTheDomainService()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        // The factory guarantees an index.html in its private web root, so
        // the SPA fallback is live for every request below: these
        // assertions prove the API boundary rejects unknown paths and
        // wrong methods even when the Angular shell exists to be served
        // (build-artifact-independent — they pass with or without a
        // Release-built wwwroot).

        // Unknown path: no endpoint maps it. The method-constrained
        // fallback answers 405 (identical to any unmapped route) and the
        // body is never the SPA shell or a domain envelope.
        var unknown = await client.PostAsJsonAsync(
            "/api/reading-training/nonexistent", new ReadingCommandRequest("http-test", "boundary-1"));
        unknown.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await unknown.Content.ReadAsStringAsync()).Should().NotContain("stateVersion")
            .And.NotContain(ReadingTrainingHttpFactory.SpaShellMarker);

        // GET on the POST-only /books route: the API boundary answers 404,
        // never the shell.
        var wrongMethod = await client.GetAsync("/api/reading-training/books");
        wrongMethod.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await wrongMethod.Content.ReadAsStringAsync()).Should().NotContain("stateVersion")
            .And.NotContain(ReadingTrainingHttpFactory.SpaShellMarker);

        // POST on the GET-only /dashboard route is likewise not a command.
        var postOnRead = await client.PostAsJsonAsync("/api/reading-training/dashboard",
            new ReadingCommandRequest("http-test", "boundary-2"));
        postOnRead.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await postOnRead.Content.ReadAsStringAsync()).Should().NotContain("stateVersion")
            .And.NotContain(ReadingTrainingHttpFactory.SpaShellMarker);

        // GET on an unknown API path is a 404, never the shell.
        var unknownGet = await client.GetAsync("/api/reading-training/nonexistent");
        unknownGet.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await unknownGet.Content.ReadAsStringAsync()).Should().NotContain(ReadingTrainingHttpFactory.SpaShellMarker);

        // A normal client-side route still serves the SPA shell: the
        // boundary isolates the API/MCP namespaces only.
        var clientRoute = await client.GetAsync("/training");
        clientRoute.StatusCode.Should().Be(HttpStatusCode.OK);
        clientRoute.Content.Headers.ContentType?.MediaType.Should().Be("text/html");
        (await clientRoute.Content.ReadAsStringAsync()).Should().Contain(ReadingTrainingHttpFactory.SpaShellMarker);
    }

    [Fact]
    public async Task InvalidBinding_AndDomainErrors_MapToExpectedStatuses()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        // Empty or malformed bodies never reach the domain service and are
        // classified as client errors by the global ProblemDetails handler.
        var emptyBody = await client.PostAsync("/api/reading-training/sessions/rate", null);
        emptyBody.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await emptyBody.Content.ReadAsStringAsync()).Should().NotContain("stateVersion");

        using var malformedContent = new StringContent("{not-json", System.Text.Encoding.UTF8, "application/json");
        var malformed = await client.PostAsync("/api/reading-training/sessions/rate", malformedContent);
        malformed.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var malformedProblem = await Envelope(malformed);
        malformedProblem.GetProperty("status").GetInt32().Should().Be(400);
        malformedProblem.TryGetProperty("stateVersion", out _).Should().BeFalse();

        // Missing non-nullable command fields bind to defaults and are then
        // rejected by the domain service (Effort=0 → invalid_ratings), so the
        // response is still a 400 domain envelope, never a routing 404/405.
        var missingFields = await client.PostAsJsonAsync("/api/reading-training/sessions/rate",
            new { clientId = "http-test", idempotencyKey = "err-rate" });
        missingFields.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(missingFields)).Should().Be("invalid_ratings");

        // Invalid idempotency identity is rejected before any state is touched.
        var noClient = await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("", "err-1", Guid.NewGuid(), ReadingMode.Endurance));
        noClient.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(noClient)).Should().Be("invalid_idempotency");

        // Unknown book → 404 book_not_found; out-of-range ratings → 400;
        // empty capture → 422; duplicate queue order → 400.
        var unknownBook = await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("http-test", "err-2", Guid.NewGuid(), ReadingMode.Endurance));
        unknownBook.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(unknownBook)).Should().Be("book_not_found");

        var badRatings = await client.PostAsJsonAsync("/api/reading-training/sessions/rate",
            new ReadingRateSessionRequest("http-test", "err-3", Effort: 11, Focus: 5));
        badRatings.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(badRatings)).Should().Be("invalid_ratings");

        var emptyCapture = await client.PostAsJsonAsync("/api/reading-training/captures",
            new ReadingCaptureRequest("http-test", "err-4", "  ", ReadingCaptureType.Thought));
        emptyCapture.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await EnvelopeCode(emptyCapture)).Should().Be("empty_capture");

        var sameId = Guid.NewGuid();
        var duplicateOrder = await client.PostAsJsonAsync("/api/reading-training/books/reorder",
            new ReadingReorderQueueRequest("http-test", "err-5",
                new[] { sameId, sameId }));
        duplicateOrder.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(duplicateOrder)).Should().Be("invalid_order");

        // Unknown assignment for a session plan → 404; mode mismatch → 422.
        var unknownAssignment = await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "err-6", Guid.NewGuid(), ReadingMode.Endurance, 30));
        unknownAssignment.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(unknownAssignment)).Should().Be("assignment_not_found");

        // A real assignment in Deep mode planned as Endurance → mode_mismatch.
        Guid bookId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var book = new PhysicalBookModel { Title = "Mismatch Book" };
            db.PhysicalBooks.Add(book);
            await db.SaveChangesAsync();
            bookId = book.Id;
        }

        var added = await Envelope(await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("http-test", "err-7", bookId, ReadingMode.Deep)));
        var assignmentId = added.GetProperty("data").GetProperty("id").GetGuid();

        var mismatch = await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "err-8", assignmentId, ReadingMode.Endurance, 30));
        mismatch.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await EnvelopeCode(mismatch)).Should().Be("mode_mismatch");
    }

    [Fact]
    public async Task FullLifecycle_OverHttp_IsExactOnce_AndMatchesFreshServiceReads()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        // Seed a physical book through a factory scope (library books are
        // outside the Reading Training REST surface).
        Guid bookId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var book = new PhysicalBookModel { Title = "Candide", Author = "Voltaire" };
            db.PhysicalBooks.Add(book);
            await db.SaveChangesAsync();
            bookId = book.Id;
        }

        // Add assignment (and make it the Endurance default in one call).
        var add = await Envelope(await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("http-test", "life-add", bookId, ReadingMode.Endurance, MakeDefault: true)));
        add.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var assignmentId = add.GetProperty("data").GetProperty("id").GetGuid();
        add.GetProperty("data").GetProperty("isDefault").GetBoolean().Should().BeTrue();
        add.GetProperty("data").GetProperty("bookTitle").GetString().Should().Be("Candide");

        // Set default is idempotent on an already-default assignment.
        var setDefault = await Envelope(await client.PostAsJsonAsync("/api/reading-training/books/default",
            new ReadingSetDefaultBookRequest("http-test", "life-default", assignmentId, ReadingMode.Endurance)));
        setDefault.GetProperty("data").GetProperty("id").GetGuid().Should().Be(assignmentId);

        // Plan → start → (invalid minutes rejected) → pause → resume →
        // complete with reported minutes → rate.
        var plan = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "life-plan", assignmentId, ReadingMode.Endurance, 40)));
        plan.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var sessionId = plan.GetProperty("data").GetProperty("id").GetGuid();
        plan.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Planned);
        var planVersion = plan.GetProperty("stateVersion").GetString();

        // Exact-once retry: same idempotency key returns the stored original
        // with Duplicate=true and identical session identity + state version.
        var planDuplicate = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "life-plan", assignmentId, ReadingMode.Endurance, 40)));
        planDuplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        planDuplicate.GetProperty("data").GetProperty("id").GetGuid().Should().Be(sessionId);
        planDuplicate.GetProperty("stateVersion").GetString().Should().Be(planVersion);

        var start = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/start",
            new ReadingStartSessionRequest("http-test", "life-start")));
        start.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Active);

        var invalidMinutes = await client.PostAsJsonAsync("/api/reading-training/sessions/complete",
            new ReadingCompleteSessionRequest("http-test", "life-complete-invalid", ReportedMinutes: 0));
        invalidMinutes.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(invalidMinutes)).Should().Be("invalid_minutes");

        var pause = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/pause",
            new ReadingSessionCommandRequest("http-test", "life-pause")));
        pause.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Paused);

        var resume = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/resume",
            new ReadingSessionCommandRequest("http-test", "life-resume")));
        resume.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Active);

        var complete = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/complete",
            new ReadingCompleteSessionRequest("http-test", "life-complete", ReportedMinutes: 25)));
        complete.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.AwaitingFeedback);
        complete.GetProperty("data").GetProperty("reportedMinutes").GetInt32().Should().Be(25);

        var rate = await Envelope(await client.PostAsJsonAsync("/api/reading-training/sessions/rate",
            new ReadingRateSessionRequest("http-test", "life-rate", Effort: 6, Focus: 7, Rating: 4)));
        rate.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        rate.GetProperty("data").GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Completed);
        var finalVersion = rate.GetProperty("stateVersion").GetString();

        // History shows exactly the completed session with all evidence.
        var history = await Envelope(await client.GetAsync("/api/reading-training/history"));
        var completed = history.GetProperty("data").EnumerateArray()
            .Single(x => x.GetProperty("id").GetGuid() == sessionId);
        completed.GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Completed);
        completed.GetProperty("reportedMinutes").GetInt32().Should().Be(25);
        completed.GetProperty("effort").GetInt32().Should().Be(6);
        completed.GetProperty("focus").GetInt32().Should().Be(7);
        completed.GetProperty("rating").GetInt32().Should().Be(4);

        // Dashboard: no open session remains, state version matches the last
        // mutation, and the assignment is still listed.
        var dashboard = await Envelope(await client.GetAsync("/api/reading-training/dashboard"));
        var dashData = dashboard.GetProperty("data");
        dashData.GetProperty("openSession").ValueKind.Should().Be(JsonValueKind.Null);
        dashData.GetProperty("books").EnumerateArray()
            .Single(x => x.GetProperty("id").GetGuid() == assignmentId);
        dashboard.GetProperty("stateVersion").GetString().Should().Be(finalVersion);

        // REST-service equivalence: a fresh service scope over the same
        // database sees the identical committed session, book, and version.
        using var freshScope = factory.Services.CreateScope();
        var service = freshScope.ServiceProvider.GetRequiredService<IReadingTrainingService>();
        var serviceHistory = await service.GetHistoryAsync();
        var serviceSessions = (IReadOnlyList<ReadingSessionDto>)serviceHistory.Data!;
        var serviceSession = serviceSessions.Single(x => x.Id == sessionId);
        serviceSession.Status.Should().Be(ReadingSessionStatus.Completed);
        serviceSession.ReportedMinutes.Should().Be(25);
        serviceSession.Effort.Should().Be(6);
        serviceSession.Focus.Should().Be(7);

        var serviceDashboard = await service.GetDashboardAsync();
        var serviceDash = (ReadingDashboardDto)serviceDashboard.Data!;
        serviceDash.Programme.StateVersion.Should().Be(finalVersion);
        serviceDash.OpenSession.Should().BeNull();
        serviceDash.Books.Should().ContainSingle(b => b.BookId == bookId && b.Id == assignmentId);
    }

    [Fact]
    public async Task CaptureLifecycle_ResolveKeepFalse_AndPromoteToNote()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        Guid bookId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var book = new PhysicalBookModel { Title = "Meditations", Author = "Marcus Aurelius" };
            db.PhysicalBooks.Add(book);
            await db.SaveChangesAsync();
            bookId = book.Id;
        }

        // Capture a question and see it in the inbox.
        var capture = await Envelope(await client.PostAsJsonAsync("/api/reading-training/captures",
            new ReadingCaptureRequest("http-test", "cap-1", "What is in our power?",
                ReadingCaptureType.Question, BookId: bookId)));
        capture.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var captureId = capture.GetProperty("data").GetProperty("id").GetGuid();
        capture.GetProperty("data").GetProperty("resolved").GetBoolean().Should().BeFalse();

        var inbox = await Envelope(await client.GetAsync("/api/reading-training/inbox"));
        inbox.GetProperty("data").EnumerateArray().Select(x => x.GetProperty("id").GetGuid())
            .Should().Contain(captureId);

        // Keep without a note is rejected and leaves the capture unresolved.
        var keepNoNote = await client.PatchAsJsonAsync($"/api/reading-training/captures/{captureId}/resolve",
            new ReadingResolveCaptureRequest("http-test", "cap-resolve-keep", Keep: true));
        keepNoNote.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(keepNoNote)).Should().Be("note_required");

        // Promote into an existing note for the same book.
        Guid noteId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var note = new NoteModel { BookId = bookId, Content = "Existing note." };
            db.Notes.Add(note);
            await db.SaveChangesAsync();
            noteId = note.Id;
        }

        var promote = await Envelope(await client.PostAsJsonAsync(
            $"/api/reading-training/captures/{captureId}/promote-to-note",
            new ReadingPromoteCaptureRequest("http-test", "cap-promote", noteId)));
        promote.GetProperty("data").GetProperty("resolved").GetBoolean().Should().BeTrue();
        promote.GetProperty("data").GetProperty("promotedNoteId").GetGuid().Should().Be(noteId);

        // Exact-once retry of the promote returns the stored original.
        var promoteDuplicate = await Envelope(await client.PostAsJsonAsync(
            $"/api/reading-training/captures/{captureId}/promote-to-note",
            new ReadingPromoteCaptureRequest("http-test", "cap-promote", noteId)));
        promoteDuplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        promoteDuplicate.GetProperty("data").GetProperty("promotedNoteId").GetGuid().Should().Be(noteId);

        // The promoted note now contains the verbatim capture text.
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var note = await db.Notes.SingleAsync(n => n.Id == noteId);
            note.Content.Should().Contain("What is in our power?");
        }

        // Resolve a second capture with Keep=false → dismissed, not promoted.
        var second = await Envelope(await client.PostAsJsonAsync("/api/reading-training/captures",
            new ReadingCaptureRequest("http-test", "cap-2", "Dismiss me.",
                ReadingCaptureType.Bookmark, BookId: bookId)));
        var secondId = second.GetProperty("data").GetProperty("id").GetGuid();

        var inboxAgain = await Envelope(await client.GetAsync("/api/reading-training/inbox"));
        inboxAgain.GetProperty("data").EnumerateArray().Select(x => x.GetProperty("id").GetGuid())
            .Should().Contain(secondId);

        var resolved = await Envelope(await client.PatchAsJsonAsync(
            $"/api/reading-training/captures/{secondId}/resolve",
            new ReadingResolveCaptureRequest("http-test", "cap-resolve", Keep: false)));
        resolved.GetProperty("data").GetProperty("resolved").GetBoolean().Should().BeTrue();
        resolved.GetProperty("data").GetProperty("promotedNoteId").ValueKind.Should().Be(JsonValueKind.Null);

        // Inbox no longer contains either resolved capture.
        var inboxAfter = await Envelope(await client.GetAsync("/api/reading-training/inbox"));
        var remaining = inboxAfter.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid()).ToList();
        remaining.Should().NotContain(captureId);
        remaining.Should().NotContain(secondId);
    }

    [Fact]
    public async Task WeeklyReview_Commit_IsExactOnce_WithStableData()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        // Fixed valid ISO week (2026-W32): the service evaluates any valid
        // week deterministically, so no clock dependency is needed.
        var preview = await Envelope(await client.GetAsync("/api/reading-training/weekly-reviews/2026/32/preview"));
        var previewData = preview.GetProperty("data");
        previewData.GetProperty("weekKey").GetString().Should().Be("2026-W32");
        previewData.GetProperty("committed").GetBoolean().Should().BeFalse();

        var commit = await Envelope(await client.PostAsJsonAsync("/api/reading-training/weekly-reviews/commit",
            new ReadingCommitWeeklyReviewRequest("http-test", "wr-1", 2026, 32)));
        commit.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var commitData = commit.GetProperty("data");
        commitData.GetProperty("weekKey").GetString().Should().Be("2026-W32");
        commitData.GetProperty("committed").GetBoolean().Should().BeTrue();
        commitData.GetProperty("committedAt").ValueKind.Should().Be(JsonValueKind.String);
        commitData.GetProperty("modes").GetArrayLength().Should().Be(3);
        var commitVersion = commit.GetProperty("stateVersion").GetString();

        // A second commit of the same week under a different key converges on
        // the immutable stored review: same data, no extra state mutation.
        var again = await Envelope(await client.PostAsJsonAsync("/api/reading-training/weekly-reviews/commit",
            new ReadingCommitWeeklyReviewRequest("http-test", "wr-2", 2026, 32)));
        again.GetProperty("data").GetProperty("committed").GetBoolean().Should().BeTrue();
        again.GetProperty("data").GetProperty("weekKey").GetString().Should().Be("2026-W32");
        again.GetProperty("data").GetProperty("committedAt").ToString()
            .Should().Be(commitData.GetProperty("committedAt").ToString());
        again.GetProperty("stateVersion").GetString().Should().Be(commitVersion);

        // Invalid week → 400 with the domain error code.
        var invalid = await client.PostAsJsonAsync("/api/reading-training/weekly-reviews/commit",
            new ReadingCommitWeeklyReviewRequest("http-test", "wr-3", 2026, 99));
        invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await EnvelopeCode(invalid)).Should().Be("invalid_week");
    }

    [Fact]
    public async Task ProductionDi_RegistersNotificationWorker_ButTestHostRunsNoWorkers()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient(); // forces the host to build

        // Program.cs registers the scanner as a hosted service; the test host
        // strips all user hosted services (the generic web host's own
        // GenericWebHostService remains, which is not a user worker), so the
        // scanner never runs against the temporary database.
        factory.ReadingNotificationWorkerRegistered.Should().BeTrue();
        factory.Services.GetServices<IHostedService>()
            .Should().NotContain(s => s is ReadingNotificationWorker);
    }

    [Fact]
    public async Task NotificationLeaseAndAck_Lifecycle_OverHttp()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        // Seed a book, assignment and an Active session already over its
        // target (server-authoritative elapsed = AccumulatedSeconds + wall
        // time since LastStartedAt), then run one scanner cycle through the
        // production outbox.
        var sessionId = await SeedOpenSessionAtTarget(factory);
        using (var scope = factory.Services.CreateScope())
        {
            var outbox = scope.ServiceProvider.GetRequiredService<IReadingNotificationOutbox>();
            (await outbox.EnqueueTargetReachedAsync()).Should().Be(1);
        }

        // First lease claims exactly one typed notification with the calm
        // message and a lease timestamp.
        var lease = await client.GetAsync(
            "/api/reading-training/notifications/lease?maxCount=10&leaseSeconds=60");
        lease.StatusCode.Should().Be(HttpStatusCode.OK);
        var leaseJson = await Envelope(lease);
        leaseJson.ValueKind.Should().Be(JsonValueKind.Array);
        var claimed = leaseJson.EnumerateArray().Should().ContainSingle().Subject;

        var payload = claimed.GetProperty("payload");
        payload.GetProperty("sessionId").GetGuid().Should().Be(sessionId);
        payload.GetProperty("bookId").ValueKind.Should().Be(JsonValueKind.String);
        payload.GetProperty("mode").ValueKind.Should().Be(JsonValueKind.Number);
        payload.GetProperty("plannedTargetMinutes").GetInt32().Should().Be(10);
        payload.GetProperty("effectiveElapsedSeconds").GetInt64().Should().BeGreaterThanOrEqualTo(600);
        payload.GetProperty("message").GetString().Should()
            .Contain("Reading target reached").And.Contain("minutes elapsed (planned 10 minutes).");

        var notificationId = claimed.GetProperty("notificationId").GetGuid();
        payload.GetProperty("notificationId").GetGuid().Should().Be(notificationId);
        var leaseUntil = DateTime.Parse(
            claimed.GetProperty("leaseUntil").GetString()!,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind);
        leaseUntil.Kind.Should().Be(DateTimeKind.Utc);
        leaseUntil.Should().BeAfter(DateTime.UtcNow.AddMinutes(-1));

        // While the lease is held the row is hidden.
        var held = await client.GetAsync(
            "/api/reading-training/notifications/lease?maxCount=10&leaseSeconds=60");
        held.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(held)).EnumerateArray().Should().BeEmpty();

        // Unknown id → 404 ProblemDetails.
        var unknown = await client.PostAsync(
            $"/api/reading-training/notifications/{Guid.NewGuid()}/ack", null);
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        unknown.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        var unknownProblem = await Envelope(unknown);
        unknownProblem.GetProperty("status").GetInt32().Should().Be(404);
        unknownProblem.GetProperty("title").GetString().Should().NotBeNullOrEmpty();

        // Ack is 200 for the existing row and idempotent on repeat.
        var ack = await client.PostAsync(
            $"/api/reading-training/notifications/{notificationId}/ack", null);
        ack.StatusCode.Should().Be(HttpStatusCode.OK);
        var ackJson = await Envelope(ack);
        ackJson.GetProperty("notificationId").GetGuid().Should().Be(notificationId);
        ackJson.GetProperty("acknowledged").GetBoolean().Should().BeTrue();

        var ackAgain = await client.PostAsync(
            $"/api/reading-training/notifications/{notificationId}/ack", null);
        ackAgain.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(ackAgain)).GetProperty("acknowledged").GetBoolean().Should().BeTrue();

        // After ack the lease is empty...
        var afterAck = await client.GetAsync(
            "/api/reading-training/notifications/lease?maxCount=10&leaseSeconds=60");
        (await Envelope(afterAck)).EnumerateArray().Should().BeEmpty();

        // ...and a restart (fresh scope + fresh client) can neither recreate
        // nor redeliver the row.
        using (var scope = factory.Services.CreateScope())
        {
            var outbox = scope.ServiceProvider.GetRequiredService<IReadingNotificationOutbox>();
            (await outbox.EnqueueTargetReachedAsync()).Should().Be(0);
        }

        using var restartedClient = factory.CreateClient();
        var restartLease = await restartedClient.GetAsync(
            "/api/reading-training/notifications/lease?maxCount=10&leaseSeconds=60");
        (await Envelope(restartLease)).EnumerateArray().Should().BeEmpty();

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            (await db.ReadingNotifications.CountAsync()).Should().Be(1);
        }
    }

    [Fact]
    public async Task NotificationLease_ValidatesQueryBounds_WithProblemDetails()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        var invalidQueries = new[]
        {
            "maxCount=0&leaseSeconds=60",     // below maxCount bound
            "maxCount=101&leaseSeconds=60",   // above maxCount bound
            "maxCount=10&leaseSeconds=0",     // below leaseSeconds bound
            "maxCount=10&leaseSeconds=3601",  // above leaseSeconds bound
        };
        foreach (var query in invalidQueries)
        {
            var response = await client.GetAsync($"/api/reading-training/notifications/lease?{query}");
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, query);
            response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json", query);
            var problem = await Envelope(response);
            problem.GetProperty("status").GetInt32().Should().Be(400, query);
        }

        // Boundary values are valid and an empty outbox answers an empty list.
        var ok = await client.GetAsync("/api/reading-training/notifications/lease?maxCount=1&leaseSeconds=1");
        ok.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(ok)).EnumerateArray().Should().BeEmpty();

        // Omitted query values use the documented transport defaults
        // (maxCount=10, leaseSeconds=60).
        var defaults = await client.GetAsync("/api/reading-training/notifications/lease");
        defaults.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(defaults)).EnumerateArray().Should().BeEmpty();
    }

    private static Task<HttpResponseMessage> InitializeAsync(
        HttpClient client, string key = "init-1", string clientId = "http-test") =>
        client.PostAsJsonAsync(
            "/api/reading-training/initialize",
            new ReadingCommandRequest(clientId, key));

    private static async Task<JsonElement> Envelope(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static async Task<string?> EnvelopeCode(HttpResponseMessage response) =>
        (await Envelope(response)).GetProperty("data").GetProperty("code").GetString();

    // Seeds an Active session that is already over its planned target by
    // persisted accumulated time alone (wall time since LastStartedAt only
    // adds more), exactly like the outbox unit-test harness.
    private static async Task<Guid> SeedOpenSessionAtTarget(ReadingTrainingHttpFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
        var now = DateTime.UtcNow;

        var book = new PhysicalBookModel { Title = $"Notification-{Guid.NewGuid():N}" };
        var assignment = new ReadingBookAssignment
        {
            Book = book,
            BookId = book.Id,
            Mode = ReadingMode.Deep,
            QueueOrder = 0,
            Status = ReadingAssignmentStatus.Active,
            CreatedAt = now,
        };
        var session = new ReadingSession
        {
            BookAssignment = assignment,
            BookAssignmentId = assignment.Id,
            Book = book,
            BookId = book.Id,
            Mode = ReadingMode.Deep,
            Status = ReadingSessionStatus.Active,
            OpenSlot = ReadingSession.OpenSentinel,
            TargetMinutes = 10,
            PlannedTargetMinutes = 10,
            AccumulatedSeconds = 700,
            PlannedAt = now.AddHours(-1),
            StartedAt = now.AddSeconds(-60),
            LastStartedAt = now.AddSeconds(-60),
            CreatedAt = now.AddHours(-1),
            UpdatedAt = now.AddHours(-1),
        };
        db.Books.Add(book);
        db.ReadingBookAssignments.Add(assignment);
        db.ReadingSessions.Add(session);
        await db.SaveChangesAsync();
        return session.Id;
    }
}
