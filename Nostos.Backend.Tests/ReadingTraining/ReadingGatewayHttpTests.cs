using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Full-host HTTP tests for POST /api/reading/gateway/dispatch (Task 10A):
// the exact route required by the optional gateway connector, valid/malformed
// bodies, stable envelope + status mapping, duplicate equivalence, and
// unrelated REST surfaces staying untouched.
public sealed class ReadingGatewayHttpTests
{
    private static Task<HttpResponseMessage> InitializeAsync(HttpClient client, string key = "init-1") =>
        client.PostAsJsonAsync("/api/reading-training/initialize", new ReadingCommandRequest("http-test", key));

    private static Task<HttpResponseMessage> DispatchAsync(
        HttpClient client, string text, string key, string clientId = "gw-test") =>
        client.PostAsJsonAsync("/api/reading/gateway/dispatch",
            new ReadingGatewayDispatchRequest(clientId, key, text));

    private static async Task<JsonElement> Envelope(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static async Task<string?> EnvelopeCode(HttpResponseMessage response) =>
        (await Envelope(response)).GetProperty("data").GetProperty("code").GetString();

    private static async Task<Guid> SeedBook(ReadingTrainingHttpFactory factory, string title)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
        var book = new PhysicalBookModel { Title = title };
        db.Books.Add(book);
        await db.SaveChangesAsync();
        return book.Id;
    }

    private static async Task<Guid> AddDefaultAssignmentAsync(
        ReadingTrainingHttpFactory factory, HttpClient client, Guid bookId, ReadingMode mode)
    {
        var response = await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("http-test", $"add-{bookId:N}", bookId, mode, MakeDefault: true));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var envelope = await Envelope(response);
        return envelope.GetProperty("data").GetProperty("id").GetGuid();
    }

    [Fact]
    public async Task GatewayDispatch_DrivesFullLifecycleThroughRawText()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBook(factory, "Candide");
        await AddDefaultAssignmentAsync(factory, client, bookId, ReadingMode.Endurance);

        // start new session through raw text
        var start = await DispatchAsync(client, "start new session", "k-start");
        start.StatusCode.Should().Be(HttpStatusCode.OK);
        var startData = (await Envelope(start)).GetProperty("data");
        startData.GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Active);

        // verbatim capture through raw text
        const string raw = "  a verbatim  thought\nwith   whitespace  ";
        var capture = await DispatchAsync(client, raw, "k-cap");
        capture.StatusCode.Should().Be(HttpStatusCode.OK);
        var captureData = (await Envelope(capture)).GetProperty("data");
        captureData.GetProperty("text").GetString().Should().Be(raw); // byte-for-byte
        captureData.GetProperty("type").GetInt32().Should().Be((int)ReadingCaptureType.Thought);

        // pause / resume / done / rate through raw text
        var paused = await DispatchAsync(client, "pause", "k-pause");
        paused.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(paused)).GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.Paused);

        var resumed = await DispatchAsync(client, "resume reading", "k-resume");
        resumed.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(resumed)).GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.Active);

        var done = await DispatchAsync(client, "done 42m", "k-done");
        done.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(done)).GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.AwaitingFeedback);

        var rated = await DispatchAsync(client, "4, 8", "k-rate");
        rated.StatusCode.Should().Be(HttpStatusCode.OK);
        var ratedData = (await Envelope(rated)).GetProperty("data");
        ratedData.GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Completed);
        ratedData.GetProperty("effort").GetInt32().Should().Be(4);
        ratedData.GetProperty("focus").GetInt32().Should().Be(8);

        // after completion, a fresh "done" gets the authoritative rejection
        var noSession = await DispatchAsync(client, "done", "k-done-2");
        noSession.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(noSession)).Should().Be("no_active_session");

        // history reflects the completed session exactly once
        var history = await Envelope(await client.GetAsync("/api/reading-training/history"));
        history.GetProperty("data").EnumerateArray().Should().ContainSingle();
    }

    [Fact]
    public async Task GatewayDispatch_DuplicateDispatch_ConvergesExactOnce()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBook(factory, "Meditations");
        // An argument-less start-new command intentionally uses the service's
        // canonical Endurance default.
        await AddDefaultAssignmentAsync(factory, client, bookId, ReadingMode.Endurance);
        (await DispatchAsync(client, "start new session", "k-start")).StatusCode.Should().Be(HttpStatusCode.OK);

        var first = await DispatchAsync(client, "a thought", "k-cap");
        var firstEnvelope = await Envelope(first);
        firstEnvelope.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var captureId = firstEnvelope.GetProperty("data").GetProperty("id").GetGuid();

        var second = await DispatchAsync(client, "a thought", "k-cap");
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondEnvelope = await Envelope(second);
        secondEnvelope.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        secondEnvelope.GetProperty("data").GetProperty("id").GetGuid().Should().Be(captureId);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
        (await db.ReadingCaptures.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync(r => r.ClientId == "gw-test" && r.IdempotencyKey == "k-cap"))
            .Should().Be(1);
    }

    [Fact]
    public async Task GatewayDispatch_StatusMapping_IsStable()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        // ignored no-ops map to 422 with the stable gateway_ignored code
        foreach (var text in new[] { "/pause", "review the week", "inbox", "read", "   " })
        {
            var ignored = await DispatchAsync(client, text, $"k-{text.Length}");
            ignored.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity, $"'{text}' should be ignored");
            (await EnvelopeCode(ignored)).Should().Be(ReadingGatewayDispatcher.IgnoredCode);
        }

        // ordinary text with no active session is a no-op, never a capture
        var ordinary = await DispatchAsync(client, "hello there", "k-ordinary");
        ordinary.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await EnvelopeCode(ordinary)).Should().Be(ReadingGatewayDispatcher.IgnoredCode);

        // authoritative service rejections map through the established rules
        var cancel = await DispatchAsync(client, "cancel", "k-cancel");
        cancel.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(cancel)).Should().Be("no_active_session");

        var rate = await DispatchAsync(client, "4, 8", "k-rate");
        rate.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await EnvelopeCode(rate)).Should().Be("no_ratings_pending");

        // status control is a read-only 200 with null data when idle
        var status = await DispatchAsync(client, "status", "k-status");
        status.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(status)).GetProperty("data").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task GatewayDispatch_AnswerNow_PausesAndLeavesQuestionInInbox()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);
        var bookId = await SeedBook(factory, "Candide");
        await AddDefaultAssignmentAsync(factory, client, bookId, ReadingMode.Endurance);
        (await DispatchAsync(client, "start new session", "k-start")).StatusCode.Should().Be(HttpStatusCode.OK);

        (await DispatchAsync(client, "question: what does Candide teach?", "k-q")).StatusCode
            .Should().Be(HttpStatusCode.OK);

        var answer = await DispatchAsync(client, "answer now", "k-ans");
        answer.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Envelope(answer)).GetProperty("data").GetProperty("status").GetInt32()
            .Should().Be((int)ReadingSessionStatus.Paused);

        // the saved question remains in the inbox for the connector to inject
        var inbox = await Envelope(await client.GetAsync("/api/reading-training/inbox"));
        var inboxItems = inbox.GetProperty("data").EnumerateArray().ToList();
        inboxItems.Should().ContainSingle();
        inboxItems[0].GetProperty("type").GetInt32().Should().Be((int)ReadingCaptureType.Question);
    }

    [Fact]
    public async Task GatewayDispatch_MalformedAndEmptyBodies_Return400ProblemDetails()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();

        var empty = await client.PostAsync("/api/reading/gateway/dispatch",
            new StringContent(string.Empty, System.Text.Encoding.UTF8, "application/json"));
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        empty.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");

        var invalidJson = await client.PostAsync("/api/reading/gateway/dispatch",
            new StringContent("{not json", System.Text.Encoding.UTF8, "application/json"));
        invalidJson.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        invalidJson.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");

        // explicit null text is handled deterministically as an ignored no-op
        var nullText = await client.PostAsJsonAsync("/api/reading/gateway/dispatch",
            new { clientId = "gw-test", idempotencyKey = "k-null", text = (string?)null });
        nullText.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await EnvelopeCode(nullText)).Should().Be(ReadingGatewayDispatcher.IgnoredCode);
    }

    [Fact]
    public async Task GatewayDispatch_UnrelatedRestSurfacesStayUntouched()
    {
        using var factory = new ReadingTrainingHttpFactory();
        using var client = factory.CreateClient();
        (await InitializeAsync(client)).StatusCode.Should().Be(HttpStatusCode.OK);

        (await DispatchAsync(client, "hello", "k-1")).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        // the reading-training surface still works normally
        var dashboard = await client.GetAsync("/api/reading-training/dashboard");
        dashboard.StatusCode.Should().Be(HttpStatusCode.OK);

        // This host's SPA/fallback pipeline resolves an unsupported method on
        // the absolute gateway route as not found; the key invariant is that
        // it never dispatches or returns success.
        var get = await client.GetAsync("/api/reading/gateway/dispatch");
        get.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // sibling routes under /api/reading/gateway do not exist
        var sibling = await client.GetAsync("/api/reading/gateway");
        sibling.StatusCode.Should().NotBe(HttpStatusCode.OK);

        // OpenAPI still describes the new route
        var openApi = await client.GetStringAsync("/openapi/v1.json");
        openApi.Should().Contain("/api/reading/gateway/dispatch");
    }
}
