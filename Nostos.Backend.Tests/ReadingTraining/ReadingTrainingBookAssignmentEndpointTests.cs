using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

/// <summary>
/// Full-host REST coverage for the issue #29 queue mutations: PATCH
/// /books/{assignmentId}/mode (change mode with safe-collider absorption) and
/// DELETE /books/{assignmentId} (remove an unused Active assignment). Every
/// assertion rides the stable envelope (reply/data/stateVersion/duplicate) and
/// the ToHttp semantic status mapping.
/// </summary>
public sealed class ReadingTrainingBookAssignmentEndpointTests
{
    private static Task<HttpResponseMessage> InitializeAsync(HttpClient client) =>
        client.PostAsJsonAsync(
            "/api/reading-training/initialize",
            new ReadingCommandRequest("http-test", "init-1"));

    private static async Task<JsonElement> Envelope(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static async Task<string?> EnvelopeCode(HttpResponseMessage response) =>
        (await Envelope(response)).GetProperty("data").GetProperty("code").GetString();

    private static async Task<Guid> SeedBookAsync(ReadingTrainingHttpFactory factory, string title)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
        var book = new PhysicalBookModel { Title = title };
        db.PhysicalBooks.Add(book);
        await db.SaveChangesAsync();
        return book.Id;
    }

    private static async Task<Guid> AddAssignmentAsync(
        HttpClient client, Guid bookId, ReadingMode mode, string key,
        bool makeDefault = false)
    {
        var response = await Envelope(await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("http-test", key, bookId, mode, makeDefault)));
        return response.GetProperty("data").GetProperty("id").GetGuid();
    }

    private static HttpRequestMessage DeleteWithBody(string url, ReadingRemoveBookAssignmentRequest body) =>
        new(HttpMethod.Delete, url) { Content = JsonContent.Create(body) };

    // --- PATCH /books/{id}/mode ---

    [Fact]
    public async Task Patch_books_assignment_mode_moves_active_assignment_and_returns_envelope()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Moved Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "mode-add");

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/mode",
            new ReadingChangeBookModeRequest("http-test", "mode-move-1", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.OK);

        var envelope = await Envelope(patch);
        envelope.GetProperty("reply").GetString().Should().Be("Moved Book moved to Deep.");
        envelope.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        envelope.GetProperty("stateVersion").GetString().Should().NotBeNullOrEmpty();

        var data = envelope.GetProperty("data");
        data.GetProperty("assignmentId").GetGuid().Should().Be(assignmentId);
        data.GetProperty("bookId").GetGuid().Should().Be(bookId);
        data.GetProperty("previousMode").GetInt32().Should().Be((int)ReadingMode.Endurance);
        data.GetProperty("mode").GetInt32().Should().Be((int)ReadingMode.Deep);
        data.GetProperty("collisionAbsorbed").GetBoolean().Should().BeFalse();
        data.GetProperty("absorbedAssignmentId").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Patch_books_assignment_mode_absorbs_session_free_collider_like_live_repair()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Truth and method");
        // Live topology: source Endurance (no default, order 2) and collider
        // Deep (mode default, order 3) — both session-free.
        var sourceId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "live-source");
        var colliderId = await AddAssignmentAsync(client, bookId, ReadingMode.Deep, "live-collider", makeDefault: true);

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{sourceId}/mode",
            new ReadingChangeBookModeRequest("http-test", "live-absorb", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.OK);

        var envelope = await Envelope(patch);
        envelope.GetProperty("reply").GetString().Should().Be(
            "Truth and method moved to Deep. Duplicate queue entry removed.");
        var data = envelope.GetProperty("data");
        data.GetProperty("assignmentId").GetGuid().Should().Be(sourceId);
        data.GetProperty("collisionAbsorbed").GetBoolean().Should().BeTrue();
        data.GetProperty("absorbedAssignmentId").GetGuid().Should().Be(colliderId);
        data.GetProperty("mode").GetInt32().Should().Be((int)ReadingMode.Deep);
        data.GetProperty("defaultSlot").ValueKind.Should().NotBe(JsonValueKind.Null);

        // Exactly one queue entry for the book, the surviving source, Deep.
        var books = await Envelope(await client.GetAsync("/api/reading-training/books"));
        var matches = books.GetProperty("data").EnumerateArray()
            .Where(b => b.GetProperty("bookId").GetGuid() == bookId).ToList();
        matches.Should().ContainSingle();
        matches[0].GetProperty("id").GetGuid().Should().Be(sourceId);
        matches[0].GetProperty("mode").GetInt32().Should().Be((int)ReadingMode.Deep);
        matches[0].GetProperty("isDefault").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_duplicate_true_on_replay()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Replay Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "replay-add");
        var request = new ReadingChangeBookModeRequest("http-test", "replay-key", ReadingMode.Recovery);

        var first = await Envelope(await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/mode", request));
        var replay = await Envelope(await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/mode", request));

        replay.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        replay.GetProperty("stateVersion").GetString().Should().Be(
            first.GetProperty("stateVersion").GetString());
        replay.GetProperty("data").GetProperty("assignmentId").GetGuid().Should().Be(assignmentId);
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_404_for_missing_assignment()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{Guid.NewGuid()}/mode",
            new ReadingChangeBookModeRequest("http-test", "missing-key", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(patch)).Should().Be("assignment_not_found");
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_409_for_same_mode()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Same Mode Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Deep, "same-add");

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/mode",
            new ReadingChangeBookModeRequest("http-test", "same-key", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(patch)).Should().Be("mode_unchanged");
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_409_when_source_has_sessions()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Sessioned Source");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "ss-add");
        await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "ss-plan", assignmentId, ReadingMode.Endurance, 40));

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/mode",
            new ReadingChangeBookModeRequest("http-test", "ss-key", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(patch)).Should().Be("assignment_has_sessions");
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_409_when_collider_has_sessions()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Sessioned Collider");
        var sourceId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "cs-source");
        var colliderId = await AddAssignmentAsync(client, bookId, ReadingMode.Deep, "cs-collider");
        await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "cs-plan", colliderId, ReadingMode.Deep, 30));

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{sourceId}/mode",
            new ReadingChangeBookModeRequest("http-test", "cs-key", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(patch)).Should().Be("mode_collision_has_sessions");
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_409_for_completed_assignment()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Completed Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "comp-add");
        await client.PostAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/finish",
            new ReadingCompleteBookRequest("http-test", "comp-finish", assignmentId));

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/mode",
            new ReadingChangeBookModeRequest("http-test", "comp-key", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(patch)).Should().Be("assignment_completed");
    }

    [Fact]
    public async Task Patch_books_assignment_mode_returns_400_for_invalid_mode()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Bad Mode Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "bad-add");

        var body = new StringContent(
            "{\"clientId\":\"http-test\",\"idempotencyKey\":\"bad-key\",\"mode\":\"Bogus\"}",
            Encoding.UTF8, "application/json");
        var patch = await client.PatchAsync(
            $"/api/reading-training/books/{assignmentId}/mode", body);
        patch.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Patch_books_assignment_without_mode_suffix_still_maps_set_default()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Default Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Deep, "def-add");

        var patch = await client.PatchAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}",
            new ReadingUpdateBookAssignmentRequest("http-test", "def-key", ReadingMode.Deep));
        patch.StatusCode.Should().Be(HttpStatusCode.OK);
        var envelope = await Envelope(patch);
        envelope.GetProperty("data").GetProperty("id").GetGuid().Should().Be(assignmentId);
        envelope.GetProperty("data").GetProperty("isDefault").GetBoolean().Should().BeTrue();
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    public async Task Unsupported_verbs_on_mode_route_return_405(string method)
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var request = new HttpRequestMessage(new HttpMethod(method),
            $"/api/reading-training/books/{Guid.NewGuid()}/mode");
        var response = await client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
    }

    // --- DELETE /books/{id} ---

    [Fact]
    public async Task Delete_books_assignment_removes_active_assignment_and_returns_envelope()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Removed Book");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "rm-add");

        var delete = await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{assignmentId}",
            new ReadingRemoveBookAssignmentRequest("http-test", "rm-key")));
        delete.StatusCode.Should().Be(HttpStatusCode.OK);

        var envelope = await Envelope(delete);
        envelope.GetProperty("reply").GetString().Should().Be("Removed Book removed from the queue.");
        envelope.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        envelope.GetProperty("data").GetProperty("assignmentId").GetGuid().Should().Be(assignmentId);

        var books = await Envelope(await client.GetAsync("/api/reading-training/books"));
        books.GetProperty("data").EnumerateArray()
            .Should().NotContain(b => b.GetProperty("id").GetGuid() == assignmentId);
    }

    [Fact]
    public async Task Delete_books_assignment_removes_mode_default_and_leaves_others_untouched()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var defaultBookId = await SeedBookAsync(factory, "Default Removed");
        var otherBookId = await SeedBookAsync(factory, "Other Book");
        var defaultId = await AddAssignmentAsync(client, defaultBookId, ReadingMode.Endurance, "drm-default", makeDefault: true);
        var otherId = await AddAssignmentAsync(client, otherBookId, ReadingMode.Endurance, "drm-other");

        var delete = await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{defaultId}",
            new ReadingRemoveBookAssignmentRequest("http-test", "drm-key")));
        delete.StatusCode.Should().Be(HttpStatusCode.OK);

        var books = await Envelope(await client.GetAsync("/api/reading-training/books"));
        var remaining = books.GetProperty("data").EnumerateArray().ToList();
        remaining.Should().ContainSingle(b => b.GetProperty("id").GetGuid() == otherId);
        remaining.Should().NotContain(b => b.GetProperty("id").GetGuid() == defaultId);
        // The removed default is gone; no orphan default claim remains.
        remaining.Single(b => b.GetProperty("id").GetGuid() == otherId)
            .GetProperty("isDefault").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Delete_books_assignment_returns_duplicate_true_on_replay()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Replay Remove");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "rrm-add");
        var request = new ReadingRemoveBookAssignmentRequest("http-test", "rrm-key");

        var first = await Envelope(await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{assignmentId}", request)));
        var replay = await Envelope(await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{assignmentId}", request)));

        replay.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        replay.GetProperty("stateVersion").GetString().Should().Be(
            first.GetProperty("stateVersion").GetString());
    }

    [Fact]
    public async Task Delete_books_assignment_returns_404_for_missing_assignment()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var delete = await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{Guid.NewGuid()}",
            new ReadingRemoveBookAssignmentRequest("http-test", "miss-key")));
        delete.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(delete)).Should().Be("assignment_not_found");
    }

    [Fact]
    public async Task Delete_books_assignment_returns_409_when_assignment_has_sessions()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Sessioned Remove");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "srm-add");
        await client.PostAsJsonAsync("/api/reading-training/sessions/plan",
            new ReadingPlanSessionRequest("http-test", "srm-plan", assignmentId, ReadingMode.Endurance, 40));

        var delete = await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{assignmentId}",
            new ReadingRemoveBookAssignmentRequest("http-test", "srm-key")));
        delete.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(delete)).Should().Be("assignment_has_sessions");
    }

    [Fact]
    public async Task Delete_books_assignment_returns_409_for_completed_assignment()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var bookId = await SeedBookAsync(factory, "Completed Remove");
        var assignmentId = await AddAssignmentAsync(client, bookId, ReadingMode.Endurance, "crm-add");
        await client.PostAsJsonAsync(
            $"/api/reading-training/books/{assignmentId}/finish",
            new ReadingCompleteBookRequest("http-test", "crm-finish", assignmentId));

        var delete = await client.SendAsync(DeleteWithBody(
            $"/api/reading-training/books/{assignmentId}",
            new ReadingRemoveBookAssignmentRequest("http-test", "crm-key")));
        delete.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await EnvelopeCode(delete)).Should().Be("assignment_completed");
    }

    // GET is deliberately absent: a GET without a GET endpoint falls through
    // to the SPA fallback (404), while non-GET verbs on the template return 405.
    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    public async Task Unsupported_verbs_on_books_assignment_route_return_405(string method)
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        var request = new HttpRequestMessage(new HttpMethod(method),
            $"/api/reading-training/books/{Guid.NewGuid()}");
        var response = await client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
    }
}
