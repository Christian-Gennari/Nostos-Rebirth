using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Services.Ai;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;
using Nostos.Product.Services.Ai;

namespace Nostos.Backend.Tests.Endpoints;

/// <summary>
/// Full-host coverage for the assistant bridge routes (issue #261 §3, §7).
///
/// Every turn test runs against <see cref="FakeLlmProvider"/>; the real 9Router
/// free pool is never called here. The only tests that exercise the real
/// provider are the "unconfigured" ones, and those never reach the network.
/// </summary>
public sealed class AssistantEndpointTests : IDisposable
{
    // A variable owned solely by this class: the provider tests set a variable
    // with the same name, and the process-wide environment is shared, so a
    // distinct name keeps the two classes from racing.
    private const string TokenVariable = "NOSTOS_ASSISTANT_ENDPOINT_TEST_TOKEN";
    private const string TokenValue = "sentinel-assistant-key-value";

    /// <summary>
    /// A configured key for the duration of every test, so the availability gate
    /// is satisfied by default; tests about the unconfigured state clear it
    /// explicitly. Cleared on dispose.
    /// </summary>
    public AssistantEndpointTests() =>
        Environment.SetEnvironmentVariable(TokenVariable, TokenValue);

    public void Dispose() =>
        Environment.SetEnvironmentVariable(TokenVariable, null);

    // ------------------------------------------------------------------
    // Turn
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_turn_returns_the_reply_and_never_the_api_key()
    {
        var provider = new FakeLlmProvider().Returns("Hello from the assistant.");

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        Environment.SetEnvironmentVariable(TokenVariable, TokenValue);
        try
        {
            var response = await client.PostAsJsonAsync(
                AssistantEndpoints.TurnRoute,
                new AssistantTurnRequest("client-1", "key-1", "Hello?", Context()));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadAsStringAsync();
            var turn = await response.Content.ReadFromJsonAsync<AssistantTurnResponse>();

            turn!.Reply.Should().Be("Hello from the assistant.");
            turn.Suggestions.Should().NotBeNull();

            // The credential lives only behind the server.
            body.Should().NotContain(TokenValue);
            body.Should().NotContain(TokenVariable);
            AssertNoCredentialField(typeof(AssistantTurnRequest));
            AssertNoCredentialField(typeof(AssistantTurnResponse));
            AssertNoCredentialField(typeof(AssistantContextDto));
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, null);
        }
    }

    [Fact]
    public async Task A_turn_accepts_client_supplied_history_over_json()
    {
        var provider = new FakeLlmProvider().Returns("Noted.");

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        // History is an appended positional member: this proves the JSON field
        // binds to AssistantTurnRequest.History (issue #286).
        var request = new AssistantTurnRequest(
            "client-1",
            "key-1",
            "And now?",
            Context(),
            History: [
                new AssistantHistoryMessageDto("user", "Remember the mountain."),
                new AssistantHistoryMessageDto("assistant", "Saved to The Magic Mountain."),
            ]);

        var response = await client.PostAsJsonAsync(AssistantEndpoints.TurnRoute, request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var messages = provider.LastRequest.Messages;
        messages.Should().Contain(m => m.Role == "user" && m.Content == "Remember the mountain.");
        messages.Should().Contain(m => m.Role == "assistant" && m.Content == "Saved to The Magic Mountain.");
    }

    [Fact]
    public async Task A_disabled_config_is_a_typed_error_not_a_500()
    {
        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider, enabled: false);
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.TurnRoute,
            new AssistantTurnRequest("client-1", "key-1", "Hello?", Context()));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await ProblemTitleAsync(response)).Should().Be(LlmErrorCodes.Disabled);
        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task An_unconfigured_key_is_a_typed_error_not_a_500()
    {
        using var factory = new LibraryEndpointFactory();

        // The REAL provider, enabled, with no credential configured: it must
        // fail typed before any outbound request.
        using var host = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Assistant:Enabled", "true");
            builder.UseSetting("Assistant:BaseUrl", "http://assistant.invalid/v1");
            builder.UseSetting("Assistant:ApiKeyEnvironmentVariable", TokenVariable);
        });
        using var client = host.CreateClient();

        Environment.SetEnvironmentVariable(TokenVariable, null);

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.TurnRoute,
            new AssistantTurnRequest("client-1", "key-1", "Hello?", Context()));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await ProblemTitleAsync(response)).Should().Be(LlmErrorCodes.NotConfigured);
    }

    // ------------------------------------------------------------------
    // Status — the single source of availability
    // ------------------------------------------------------------------

    [Fact]
    public async Task Status_is_unavailable_when_no_key_is_configured()
    {
        Environment.SetEnvironmentVariable(TokenVariable, null);

        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var response = await client.GetAsync(AssistantEndpoints.StatusRoute);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        var status = await response.Content.ReadFromJsonAsync<JsonElement>();
        status.GetProperty("available").GetBoolean().Should().BeFalse();

        // Presence, never a hint: neither the variable's name nor its value may
        // appear in the body.
        body.Should().NotContain(TokenVariable);
        body.Should().NotContain(TokenValue);
    }

    [Fact]
    public async Task Status_is_available_when_a_key_is_configured_and_never_contains_it()
    {
        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var response = await client.GetAsync(AssistantEndpoints.StatusRoute);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        var status = await response.Content.ReadFromJsonAsync<JsonElement>();
        status.GetProperty("available").GetBoolean().Should().BeTrue();
        body.Should().NotContain(TokenValue);
        body.Should().NotContain(TokenVariable);
    }

    [Fact]
    public async Task Status_answers_without_requiring_the_kill_switch_to_be_on()
    {
        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider, enabled: false);
        using var client = host.CreateClient();

        var response = await client.GetAsync(AssistantEndpoints.StatusRoute);

        // Not a 503: the status route reports availability, it does not require
        // it. The kill switch simply renders the answer false.
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var status = await response.Content.ReadFromJsonAsync<JsonElement>();
        status.GetProperty("available").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Turn_is_a_typed_503_when_the_status_reports_unavailable()
    {
        Environment.SetEnvironmentVariable(TokenVariable, null);

        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var status = await client.GetFromJsonAsync<JsonElement>(AssistantEndpoints.StatusRoute);
        status.GetProperty("available").GetBoolean().Should().BeFalse();

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.TurnRoute,
            new AssistantTurnRequest("client-1", "key-1", "Hello?", Context()));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await ProblemTitleAsync(response)).Should().Be(LlmErrorCodes.NotConfigured);
        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task A_capture_turn_saves_through_the_canonical_note_path()
    {
        var bookId = Guid.Empty;

        // The book is created after the host exists, so the responder reads the
        // id at call time through the captured variable.
        var provider = new FakeLlmProvider
        {
            Responder = call => call == 1
                ? new LlmCompletion(
                    null,
                    "tool_calls",
                    [new LlmToolCall(
                        "call-1",
                        "notes_capture",
                        JsonSerializer.Serialize(new { bookId, content = "Captured via HTTP" }))])
                : new LlmCompletion("Saved.", "stop", []),
        };

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var book = await CreateBookAsync(client);
        bookId = book.Id;

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.TurnRoute,
            new AssistantTurnRequest(
                "client-http",
                "key-http",
                "Remember this.",
                Context(
                    bookId: book.Id.ToString(),
                    bookTitle: book.Title,
                    bookFormat: "ebook",
                    readerType: "epub",
                    epubCfi: "epubcfi(/6/4[chap01]!/4/2/2)")));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var turn = await response.Content.ReadFromJsonAsync<AssistantTurnResponse>();
        turn!.Acknowledgement.Should().NotBeNullOrWhiteSpace();

        // The note is the canonical one, reachable through the ordinary REST route.
        var notes = await client.GetFromJsonAsync<NoteDto[]>($"/api/books/{book.Id}/notes");
        notes.Should().ContainSingle().Which.Content.Should().Be("Captured via HTTP");
    }

    [Fact]
    public async Task Entitlement_denial_stops_the_turn_before_the_provider()
    {
        var provider = new FakeLlmProvider().Returns("must not run");

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider, entitled: false);
        using var client = host.CreateClient();

        var status = await client.GetFromJsonAsync<JsonElement>(AssistantEndpoints.StatusRoute);
        status.GetProperty("available").GetBoolean().Should().BeFalse();

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.TurnRoute,
            new AssistantTurnRequest("client-1", "key-1", "Hello?", Context()));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ProblemTitleAsync(response)).Should().Be(LlmErrorCodes.AccessDenied);
        provider.CallCount.Should().Be(0);
    }

    // ------------------------------------------------------------------
    // Approve
    // ------------------------------------------------------------------

    [Fact]
    public async Task Approving_an_unknown_plan_is_refused_with_a_typed_error()
    {
        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.ApproveRoute,
            new AssistantPlanApproveRequest("does-not-exist", "some-token"));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ProblemTitleAsync(response)).Should().Be(AssistantErrorCodes.NotFound);
    }

    [Fact]
    public async Task Approving_with_a_missing_token_is_refused()
    {
        var provider = new FakeLlmProvider();

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync(
            AssistantEndpoints.ApproveRoute,
            new AssistantPlanApproveRequest("some-plan", null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemTitleAsync(response)).Should().Be(AssistantErrorCodes.ApprovalRequired);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static AssistantContextDto Context(
        string? bookId = null,
        string? bookTitle = null,
        string? bookFormat = null,
        string? readerType = null,
        string? epubCfi = null) =>
        new(
            "second-brain",
            "/second-brain",
            bookId,
            bookTitle,
            bookFormat,
            readerType,
            epubCfi);

    private static async Task<BookDto> CreateBookAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"Assistant Book {Guid.NewGuid():N}",
            author = "An Author",
            forceCreate = true,
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<BookDto>())!;
    }

    private static async Task<string?> ProblemTitleAsync(HttpResponseMessage response)
    {
        var document = await response.Content.ReadFromJsonAsync<JsonElement>();
        return document.GetProperty("title").GetString();
    }

    private static void AssertNoCredentialField(Type dtoType)
    {
        var suspicious = dtoType.GetProperties()
            .Select(p => p.Name)
            .Where(name => name.Contains("apikey", StringComparison.OrdinalIgnoreCase)
                        || name.Contains("secret", StringComparison.OrdinalIgnoreCase)
                        || name.Contains("credential", StringComparison.OrdinalIgnoreCase))
            .ToList();

        suspicious.Should().BeEmpty(
            $"{dtoType.Name} must never carry the provider credential (found: {string.Join(", ", suspicious)})");
    }

    private static WebApplicationFactory<Program> CreateHost(
        LibraryEndpointFactory factory,
        FakeLlmProvider provider,
        bool enabled = true,
        bool entitled = true)
    {
        return factory.WithWebHostBuilder(builder =>
        {
            // UseSetting (host configuration) reaches the top-level Program.cs
            // read of builder.Configuration, exactly like the Speech tests.
            builder.UseSetting("Assistant:Enabled", enabled ? "true" : "false");
            builder.UseSetting("Assistant:BaseUrl", "http://assistant.invalid/v1");
            builder.UseSetting("Assistant:ApiKeyEnvironmentVariable", TokenVariable);
            builder.UseSetting("Assistant:MaxToolIterations", "6");

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<ILlmProvider>();
                services.AddSingleton<ILlmProvider>(provider);

                if (!entitled)
                {
                    services.RemoveAll<IAiAccessPolicy>();
                    services.AddSingleton<IAiAccessPolicy, DenyManagedAiAccessPolicy>();
                }
            });
        });
    }

    private sealed class DenyManagedAiAccessPolicy : IAiAccessPolicy
    {
        public Task<bool> IsAllowedAsync(CancellationToken ct = default) =>
            Task.FromResult(false);
    }
}
