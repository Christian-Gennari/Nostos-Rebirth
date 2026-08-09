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
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Real HTTP integration host for the Reading Training REST foundation
// (Task 5A): the full Nostos.Backend Program (top-level statements, DI,
// middleware, OpenAPI) runs on a TestServer backed by a real temporary-file
// SQLite database, so routing, DI lifetime, and persistence are exercised
// end-to-end instead of through unit-test mocks.
public sealed class ReadingTrainingHttpFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath;

    public ReadingTrainingHttpFactory()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"nostos-reading-http-{Guid.NewGuid():N}.db");
        ReadingTrainingHttpBootstrap.EnsureSchemaAndHistory(_dbPath);
    }

    public string DatabasePath => _dbPath;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            // Replace the production SQLite registration: both the scoped
            // NostosDbContext and the IDbContextFactory<NostosDbContext> must
            // resolve against the same temporary file. The options are
            // registered once with singleton lifetime, exactly like Program.cs,
            // so both surface types share one options instance.
            services.RemoveAll<DbContextOptions>();
            services.RemoveAll<DbContextOptions<NostosDbContext>>();
            services.RemoveAll<NostosDbContext>();
            services.RemoveAll<IDbContextFactory<NostosDbContext>>();

            // Disable the production hosted workers (concept cleanup + backup
            // poller) so they cannot race the temporary database in tests.
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
        dashData.GetProperty("currentWeek").ValueKind.Should().Be(JsonValueKind.Null);

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
}
