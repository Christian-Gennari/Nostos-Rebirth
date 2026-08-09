using System.Net;
using System.Net.Http.Json;
using System.Text;
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
using Nostos.Backend.Services;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Tests.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Mcp;

// Real HTTP integration host for the MCP Streamable HTTP foundation
// (Task 9A): the full Nostos.Backend Program (top-level statements, DI,
// middleware, endpoint mapping) runs on a TestServer backed by a real
// temporary-file SQLite database.
public sealed class McpHttpFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath;
    private readonly bool _enabled;
    private readonly string? _path;
    private readonly string? _envVarName;

    public McpHttpFactory(bool enabled, string? path = null, string? envVarName = null)
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"nostos-mcp-{Guid.NewGuid():N}.db");
        ReadingTrainingHttpBootstrap.EnsureSchemaAndHistory(_dbPath);
        _enabled = enabled;
        _path = path;
        _envVarName = envVarName;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            // Same isolation as the Reading Training HTTP factory: a
            // temporary SQLite database and no production hosted workers.
            services.RemoveAll<DbContextOptions>();
            services.RemoveAll<DbContextOptions<NostosDbContext>>();
            services.RemoveAll<NostosDbContext>();
            services.RemoveAll<IDbContextFactory<NostosDbContext>>();
            services.RemoveAll<IHostedService>();

            services.AddDbContext<NostosDbContext>(
                options => options.UseSqlite($"Data Source={_dbPath}"),
                ServiceLifetime.Scoped,
                ServiceLifetime.Singleton);
            services.AddDbContextFactory<NostosDbContext>(
                options => options.UseSqlite($"Data Source={_dbPath}"));
        });

        // Overrides are applied to the host configuration before Program's
        // top-level statements run, so startup validation sees them.
        builder.UseSetting("Mcp:Enabled", _enabled ? "true" : "false");
        if (_path is not null)
        {
            builder.UseSetting("Mcp:Path", _path);
        }

        if (_envVarName is not null)
        {
            builder.UseSetting("Mcp:ApiKeyEnvironmentVariable", _envVarName);
        }
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

// Every MCP test that reads or writes process environment variables lives in
// this collection. xUnit runs collections in parallel by default, so the
// collection disables parallelization: the token environment variable is set
// before each host starts and restored exactly afterwards, and no other test
// touches these variable names, so there is no cross-collection interference.
[CollectionDefinition("McpEnvironment", DisableParallelization = true)]
public sealed class McpEnvironmentCollection;

[Collection("McpEnvironment")]
public sealed class McpHttpTests
{
    private const string TestToken = "t9a-super-secret-token";
    private const string TestEnvVar = "NOSTOS_MCP_TOKEN_T9A";
    private const string MissingEnvVar = "NOSTOS_MCP_TOKEN_T9A_MISSING";

    [Fact]
    public async Task DisabledByDefault_RestWorksAndMcpIsNotMapped()
    {
        using var factory = new McpHttpFactory(enabled: false);
        using var client = factory.CreateClient();

        var rest = await client.GetAsync("/api/reading-training/status");
        rest.StatusCode.Should().Be(HttpStatusCode.OK);

        // With MCP disabled the route is not mapped: it behaves exactly like
        // any other unknown path in this application. Non-GET requests fall
        // through to the SPA fallback's method constraint (405, identical to
        // an arbitrary unmapped route), and GET serves the SPA like any other
        // client-side route.
        var controlPost = await PostAsync(client, "/definitely-not-a-route", InitializeBody());
        controlPost.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);

        var post = await PostAsync(client, "/mcp", InitializeBody());
        post.StatusCode.Should().Be(controlPost.StatusCode);

        var delete = await client.DeleteAsync("/mcp");
        delete.StatusCode.Should().Be(controlPost.StatusCode);

        var get = await client.GetAsync("/mcp");
        var controlGet = await client.GetAsync("/definitely-not-a-route");
        get.StatusCode.Should().Be(controlGet.StatusCode);
    }

    [Fact]
    public void EnabledWithoutToken_FailsStartupClosed()
    {
        using var env = SetEnvVar(MissingEnvVar, null);

        using var factory = new McpHttpFactory(enabled: true, envVarName: MissingEnvVar);
        var exception = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Messages(exception).Should().Contain(m =>
            m.Contains(MissingEnvVar, StringComparison.Ordinal) && m.Contains("MCP", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Auth_RequiresExactBearerToken_OnMcpPathAndDescendants_Only()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // Missing header.
        (await PostAsync(client, "/mcp", InitializeBody())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Wrong token.
        (await PostWithAuth(client, "wrong-token")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Wrong scheme (case-insensitive scheme prefix is accepted, but Basic
        // is not a bearer credential).
        (await PostWithAuth(client, TestToken, scheme: "Basic")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // "Bearer" without the separating space.
        (await PostWithAuth(client, TestToken, header: $"Bearer{TestToken}")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Empty credential.
        (await PostWithAuth(client, TestToken, header: "Bearer ")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Embedded whitespace: not an exact `Bearer <token>` value.
        (await PostWithAuth(client, TestToken, header: $"Bearer {TestToken} extra")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Query-token authentication is never accepted (no token in query).
        (await PostAsync(client, $"/mcp?token={TestToken}", InitializeBody())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Descendant of the MCP path is gated too.
        (await PostAsync(client, "/mcp/tools", ToolsListBody())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // OPTIONS is intentionally not exempted (Nostos has no CORS): it is
        // gated like every other method, so unauthenticated preflight probes
        // fail closed.
        using (var options = new HttpRequestMessage(HttpMethod.Options, "/mcp"))
        {
            (await client.SendAsync(options)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        // A valid OPTIONS passes the gate and is rejected by routing only.
        using (var options = new HttpRequestMessage(HttpMethod.Options, "/mcp"))
        {
            options.Headers.TryAddWithoutValidation("Authorization", $"Bearer {TestToken}");
            (await client.SendAsync(options)).StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        }

        // Unrelated paths are unaffected: no auth required.
        (await client.GetAsync("/api/reading-training/status")).StatusCode.Should().Be(HttpStatusCode.OK);

        // The exact token passes the gate (protocol shape asserted below).
        (await PostWithAuth(client, TestToken)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Auth_DuplicateAuthorizationHeaders_FailClosed_WithoutLeakingToken()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // Duplicate Authorization headers are never first-valid: the server
        // sees the joined header value, which can never be the exact
        // `Bearer <token>` form, so both identical valid tokens and a
        // valid+garbage pair fail closed (no token may leak into responses).
        foreach (var headers in new[]
        {
            new[] { $"Bearer {TestToken}", $"Bearer {TestToken}" },
            new[] { $"Bearer {TestToken}", $"Bearer wrong-token" },
        })
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
            {
                Content = InitializeBody(),
            };
            foreach (var header in headers)
            {
                request.Headers.TryAddWithoutValidation("Authorization", header);
            }

            using var response = await client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            var body = await response.Content.ReadAsStringAsync();
            body.Should().NotContain(TestToken);
            response.Headers.WwwAuthenticate.ToString().Should().NotContain(TestToken);
        }
    }

    [Fact]
    public async Task Protocol_InitializeAndToolsList_SucceedWithToken()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var initialize = await PostWithAuth(client, TestToken, body: InitializeBody());
        initialize.StatusCode.Should().Be(HttpStatusCode.OK);
        // Streamable HTTP serves JSON-RPC either as application/json or as a
        // text/event-stream-encoded message depending on Accept negotiation.
        initialize.Content.Headers.ContentType?.MediaType.Should().BeOneOf("application/json", "text/event-stream");

        using var initJson = await ReadJsonRpcAsync(initialize);
        initJson.RootElement.GetProperty("jsonrpc").GetString().Should().Be("2.0");
        var result = initJson.RootElement.GetProperty("result");
        result.GetProperty("protocolVersion").GetString().Should().NotBeNullOrEmpty();
        var serverInfo = result.GetProperty("serverInfo");
        serverInfo.GetProperty("name").GetString().Should().Be("nostos");
        serverInfo.GetProperty("version").GetString().Should().NotBeNullOrEmpty();
        // Task 9A registered only the static identity tool; Task 9B1 replaced
        // it with the read-only Reading Training tool surface, Task 9B2 adds
        // the nine exact-once session/capture mutation tools, and Task 9B2b
        // adds the five book/capture/weekly-review mutations. The protocol-
        // level tools/list call below verifies discovery over the real
        // transport: exactly the twenty-one tools, no bootstrap identity
        // tool, and no client id/key arguments on the read surface.
        var toolsList = await PostWithAuth(client, TestToken, body: ToolsListBody());
        toolsList.StatusCode.Should().Be(HttpStatusCode.OK);

        using var listJson = await ReadJsonRpcAsync(toolsList);
        var hasResult = listJson.RootElement.TryGetProperty("result", out var listResult);
        hasResult.Should().BeTrue($"tools/list response was {listJson.RootElement.GetRawText()}");
        var hasTools = listResult.TryGetProperty("tools", out var tools);
        hasTools.Should().BeTrue($"tools/list response was {listJson.RootElement.GetRawText()}");
        tools.ValueKind.Should().Be(JsonValueKind.Array);

        var expectedReadNames = new[]
        {
            "reading_get_dashboard",
            "reading_get_status",
            "reading_get_week",
            "reading_list_history",
            "reading_list_books",
            "reading_list_inbox",
            "reading_preview_review",
        };
        var expectedMutationNames = new[]
        {
            "reading_plan_session",
            "reading_start_session",
            "reading_pause_session",
            "reading_resume_session",
            "reading_complete_session",
            "reading_rate_session",
            "reading_cancel_session",
            "reading_capture",
            "reading_answer_now",
            "reading_add_book",
            "reading_set_default_book",
            "reading_finish_book",
            "reading_resolve_capture",
            "reading_commit_review",
        };
        var names = tools.EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        names.Should().HaveCount(expectedReadNames.Length + expectedMutationNames.Length)
            .And.BeEquivalentTo(expectedReadNames.Concat(expectedMutationNames));
        names.Should().NotContain("nostos_server_info");

        var byName = tools.EnumerateArray().ToDictionary(t => t.GetProperty("name").GetString()!);

        // Reads: declared read-only, and never accept client id or
        // idempotency key arguments.
        foreach (var name in expectedReadNames)
        {
            var tool = byName[name];
            tool.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean()
                .Should().BeTrue(name);

            var schema = tool.GetProperty("inputSchema");
            schema.GetProperty("type").GetString().Should().Be("object");
            var rawSchema = schema.GetRawText().ToLowerInvariant();
            rawSchema.Should().NotContain("client")
                .And.NotContain("idempotency");
        }

        // The five no-argument reads expose an empty properties bag.
        foreach (var name in expectedReadNames.Where(n => n != "reading_preview_review"))
        {
            var schema = byName[name].GetProperty("inputSchema");
            if (schema.TryGetProperty("properties", out var props))
            {
                props.EnumerateObject().Should().BeEmpty(name);
            }
        }

        // Preview is the only read with arguments: ISO year and week are
        // required integers, exactly the fields of the read-only service
        // request, with no client/key arguments.
        var previewSchema = byName["reading_preview_review"].GetProperty("inputSchema");
        var previewProps = previewSchema.GetProperty("properties");
        previewProps.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("year", "week");
        previewProps.GetProperty("year").GetProperty("type").GetString().Should().Be("integer");
        previewProps.GetProperty("week").GetProperty("type").GetString().Should().Be("integer");
        previewSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("year", "week");

        // Mutations: never advertised read-only, and every one requires a
        // caller-supplied idempotencyKey (no default, no client id — the
        // fixed client identity is injected by the tool, never by the client).
        foreach (var name in expectedMutationNames)
        {
            var tool = byName[name];
            // The SDK omits annotations for tools that declare none; when
            // present, a mutation must never be advertised read-only (only
            // the seven read tools carry readOnlyHint: true) and never
            // destructive.
            if (tool.TryGetProperty("annotations", out var annotations))
            {
                if (annotations.TryGetProperty("readOnlyHint", out var readOnlyHint))
                {
                    readOnlyHint.GetBoolean()
                        .Should().BeFalse($"tool {name} raw: {tool.GetRawText()}");
                }

                if (annotations.TryGetProperty("destructiveHint", out var destructiveHint))
                {
                    destructiveHint.GetBoolean()
                        .Should().BeFalse($"tool {name} raw: {tool.GetRawText()}");
                }
            }

            var schema = tool.GetProperty("inputSchema");
            schema.GetProperty("type").GetString().Should().Be("object");
            var required = schema.GetProperty("required").EnumerateArray()
                .Select(r => r.GetString()).ToArray();
            required.Should().Contain("idempotencyKey", $"tool {name} raw: {tool.GetRawText()}");
            var props = schema.GetProperty("properties");
            props.TryGetProperty("clientId", out _).Should().BeFalse($"tool {name} raw: {tool.GetRawText()}");
            props.GetProperty("idempotencyKey").TryGetProperty("default", out _)
                .Should().BeFalse($"tool {name} raw: {tool.GetRawText()}");

            // Descriptions stay neutral: no streak/debt/guilt framing.
            var rawTool = tool.GetRawText().ToLowerInvariant();
            rawTool.Should().NotContain("streak").And.NotContain("debt").And.NotContain("guilt");
        }

        // Plan: assignment, mode, and target are required; constraint is the
        // optional enum with its service default. Numeric enums are accepted
        // as string-typed enums over MCP (names, never REST numbers).
        var planSchema = byName["reading_plan_session"].GetProperty("inputSchema");
        planSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "bookAssignmentId", "mode", "targetMinutes");
        var planProps = planSchema.GetProperty("properties");
        planProps.TryGetProperty("constraint", out _).Should().BeTrue();
        planProps.GetProperty("mode").GetProperty("type").GetString().Should().Be("string");
        planProps.GetProperty("mode").GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo("Endurance", "Deep", "Recovery");
        planProps.GetProperty("constraint").GetProperty("enum").EnumerateArray()
            .Select(e => e.GetString())
            .Should().BeEquivalentTo("None", "TimeConstrained", "FatigueConstrained");

        // Start: sessionId is optional (properties, not required).
        var startSchema = byName["reading_start_session"].GetProperty("inputSchema");
        startSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey");
        startSchema.GetProperty("properties").TryGetProperty("sessionId", out _).Should().BeTrue();

        // Open-session commands act on the open session: no sessionId
        // property at all (their exact required sets are asserted per tool).
        foreach (var name in new[]
        {
            "reading_pause_session", "reading_resume_session", "reading_complete_session",
            "reading_rate_session", "reading_cancel_session", "reading_answer_now",
        })
        {
            var schema = byName[name].GetProperty("inputSchema");
            schema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
                .Should().Contain("idempotencyKey", name);
            schema.GetProperty("properties").TryGetProperty("sessionId", out _)
                .Should().BeFalse($"tool {name} raw: {schema.GetRawText()}");
        }

        var completeProps = byName["reading_complete_session"].GetProperty("inputSchema")
            .GetProperty("properties");
        completeProps.TryGetProperty("reportedMinutes", out _).Should().BeTrue();

        // Rate: effort and focus required, rating optional; the description
        // frames ratings as measurements, not as achievements/gamification.
        var rateSchema = byName["reading_rate_session"].GetProperty("inputSchema");
        rateSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "effort", "focus");
        rateSchema.GetProperty("properties").TryGetProperty("rating", out _).Should().BeTrue();
        var rateDescription = byName["reading_rate_session"].GetProperty("description").GetString()!;
        rateDescription.Should().Contain("measurements")
            .And.Contain("ratings")
            .And.Contain("not achievements");

        // Capture: text/type/key required; attachments optional; no invented
        // page field (the capture DTO has no page properties).
        var captureSchema = byName["reading_capture"].GetProperty("inputSchema");
        captureSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "text", "type");
        var captureProps = captureSchema.GetProperty("properties");
        foreach (var optional in new[] { "bookId", "sessionId", "externalId" })
        {
            captureProps.TryGetProperty(optional, out _).Should().BeTrue(optional);
        }

        captureProps.TryGetProperty("pages", out _).Should().BeFalse("the capture DTO has no page fields");
        captureProps.GetProperty("type").GetProperty("type").GetString().Should().Be("string");
        captureProps.GetProperty("type").GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo("Thought", "Question", "Bookmark");

        // Add book: an existing Nostos book is assigned by id only — no
        // title/author/page arguments are invented; makeDefault is the only
        // optional flag, and the description explicitly says pages are
        // optional book progress, never the training target.
        var addSchema = byName["reading_add_book"].GetProperty("inputSchema");
        addSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "bookId", "mode");
        var addProps = addSchema.GetProperty("properties");
        addProps.GetProperty("bookId").GetProperty("type").GetString().Should().Be("string");
        addProps.GetProperty("bookId").GetProperty("format").GetString().Should().Be("uuid");
        addProps.GetProperty("makeDefault").GetProperty("type").GetString().Should().Be("boolean");
        addProps.TryGetProperty("pages", out _).Should().BeFalse("the assignment DTO has no page fields");
        addProps.TryGetProperty("title", out _).Should().BeFalse("the book is assigned by id, never by title");
        addProps.TryGetProperty("author", out _).Should().BeFalse("the book is assigned by id, never by author");
        var addDescription = byName["reading_add_book"].GetProperty("description").GetString()!;
        addDescription.Should().Contain("Pages are optional")
            .And.Contain("never the training target");

        // Set default: exact assignment id + mode from the request DTO; the
        // tool never infers which assignment is or should be default.
        var setDefaultSchema = byName["reading_set_default_book"].GetProperty("inputSchema");
        setDefaultSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "bookAssignmentId", "mode");
        setDefaultSchema.GetProperty("properties").TryGetProperty("sessionId", out _)
            .Should().BeFalse("the assignment is addressed by bookAssignmentId only");

        // Finish book: assignment id only.
        byName["reading_finish_book"].GetProperty("inputSchema")
            .GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "bookAssignmentId");

        // Resolve capture: captureId and the keep action are required; noteId
        // is optional exactly because the request DTO declares it optional —
        // the server validates ids and the note requirement.
        var resolveSchema = byName["reading_resolve_capture"].GetProperty("inputSchema");
        resolveSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "captureId", "keep");
        var resolveProps = resolveSchema.GetProperty("properties");
        resolveProps.GetProperty("keep").GetProperty("type").GetString().Should().Be("boolean");
        resolveProps.GetProperty("captureId").GetProperty("format").GetString().Should().Be("uuid");
        resolveProps.TryGetProperty("noteId", out _).Should().BeTrue("the resolve request DTO has an optional note id");

        // Commit review: explicit ISO year/week required integers; the
        // description is neutral — the server recomputes the review and
        // never claims a preview is binding.
        var commitSchema = byName["reading_commit_review"].GetProperty("inputSchema");
        commitSchema.GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .Should().BeEquivalentTo("idempotencyKey", "year", "week");
        var commitProps = commitSchema.GetProperty("properties");
        commitProps.GetProperty("year").GetProperty("type").GetString().Should().Be("integer");
        commitProps.GetProperty("week").GetProperty("type").GetString().Should().Be("integer");
        var commitDescription = byName["reading_commit_review"].GetProperty("description").GetString()!;
        commitDescription.Should().Contain("recomputes");
        commitDescription.Should().NotContain("preview").And.NotContain("binding");
    }

    [Fact]
    public async Task ToolsCall_ReadOnlyTools_ReturnExactServiceEnvelopes()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // Bootstrap the programme over the unauthenticated REST surface so the
        // read-only MCP tools have real server state to report, then exercise
        // the authenticated transport end-to-end (DI wiring included).
        var initialize = await client.PostAsync(
            "/api/reading-training/initialize",
            JsonBody(new { clientId = "mcp-tests", idempotencyKey = "9b1-bootstrap" }));
        initialize.StatusCode.Should().Be(HttpStatusCode.OK);

        (await PostWithAuth(client, TestToken)).StatusCode.Should().Be(HttpStatusCode.OK);

        // --- reading_get_dashboard: the exact service envelope/data ---
        var dashEnvelope = await ToolCallAsync(client, TestToken, "reading_get_dashboard", new { });
        dashEnvelope.GetProperty("reply").GetString().Should().Contain("Dashboard");
        dashEnvelope.GetProperty("stateVersion").GetString().Should().NotBeNullOrEmpty();
        dashEnvelope.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var dashData = dashEnvelope.GetProperty("data");
        dashData.GetProperty("programme").GetProperty("timezoneId").GetString().Should().Be("Europe/Stockholm");
        dashData.GetProperty("books").ValueKind.Should().Be(JsonValueKind.Array);
        dashData.GetProperty("currentWeek").GetProperty("weekKey").GetString()
            .Should().MatchRegex(@"^\d{4}-W\d{2}$");

        // --- reading_get_week: only the server's current-week summary ---
        var weekData = (await ToolCallAsync(client, TestToken, "reading_get_week", new { }))
            .GetProperty("data");
        weekData.GetProperty("weekKey").GetString().Should().MatchRegex(@"^\d{4}-W\d{2}$");
        weekData.GetProperty("completedSessions").GetInt32().Should().Be(0);
        weekData.GetProperty("volumeMinutes").GetInt32().Should().Be(0);
        weekData.TryGetProperty("books", out _).Should().BeFalse();
        weekData.TryGetProperty("programme", out _).Should().BeFalse();

        // --- reading_list_books: only the server's book queue ---
        var booksData = (await ToolCallAsync(client, TestToken, "reading_list_books", new { }))
            .GetProperty("data");
        booksData.ValueKind.Should().Be(JsonValueKind.Array);
        booksData.GetRawText().Should().NotContain("weekKey");

        // --- reading_get_status: no active session, same server state ---
        var statusEnvelope = await ToolCallAsync(client, TestToken, "reading_get_status", new { });
        statusEnvelope.GetProperty("reply").GetString().Should().Be("No active reading session.");
        statusEnvelope.GetProperty("stateVersion").GetString()
            .Should().Be(dashEnvelope.GetProperty("stateVersion").GetString());

        // --- reading_list_history / reading_list_inbox: server collections ---
        (await ToolCallAsync(client, TestToken, "reading_list_history", new { }))
            .GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        (await ToolCallAsync(client, TestToken, "reading_list_inbox", new { }))
            .GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);

        // --- reading_preview_review: read-only preview for an explicit week ---
        var previewData = (await ToolCallAsync(
            client, TestToken, "reading_preview_review", new { year = 2026, week = 32 }))
            .GetProperty("data");
        previewData.GetProperty("weekKey").GetString().Should().Be("2026-W32");
        previewData.GetProperty("committed").GetBoolean().Should().BeFalse();
        previewData.GetProperty("modes").GetArrayLength().Should().Be(3);
        previewData.GetProperty("stateVersion").GetString()
            .Should().Be(dashEnvelope.GetProperty("stateVersion").GetString());
    }

    [Fact]
    public async Task ToolsCall_Mutations_AreExactOnce_AndRestSeesAuthoritativeState()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // REST bootstrap: initialize the programme, then seed real library
        // books through a factory scope (creating catalog books is outside
        // the MCP surface — reading_add_book assigns an existing book by id)
        // and add an Endurance assignment over REST.
        var initialize = await client.PostAsync(
            "/api/reading-training/initialize",
            JsonBody(new { clientId = "mcp-tests", idempotencyKey = "9b2-bootstrap" }));
        initialize.StatusCode.Should().Be(HttpStatusCode.OK);

        Guid bookId, deepBookId, enduranceBookId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
            var book = new PhysicalBookModel { Title = "Candide", Author = "Voltaire" };
            var deepBook = new PhysicalBookModel { Title = "Meditations", Author = "Marcus Aurelius" };
            var enduranceBook = new PhysicalBookModel { Title = "De Rerum Natura", Author = "Lucretius" };
            db.PhysicalBooks.AddRange(book, deepBook, enduranceBook);
            await db.SaveChangesAsync();
            bookId = book.Id;
            deepBookId = deepBook.Id;
            enduranceBookId = enduranceBook.Id;
        }

        using var addResponse = await client.PostAsJsonAsync("/api/reading-training/books",
            new ReadingAddBookAssignmentRequest("mcp-tests", "9b2-add", bookId, ReadingMode.Endurance, MakeDefault: true));
        addResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var addJson = JsonDocument.Parse(await addResponse.Content.ReadAsStringAsync());
        var assignmentId = addJson.RootElement.GetProperty("data").GetProperty("id").GetGuid();

        // --- reading_add_book: existing Nostos book by id, fresh command ---
        var addDeep = await ToolCallAsync(client, TestToken, "reading_add_book", new
        {
            idempotencyKey = "e2e-add-deep",
            bookId = deepBookId.ToString(),
            mode = "Deep",
            makeDefault = true,
        });
        addDeep.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        addDeep.GetProperty("data").GetProperty("mode").GetString().Should().Be("Deep");
        addDeep.GetProperty("data").GetProperty("isDefault").GetBoolean().Should().BeTrue();
        var deepAssignmentId = addDeep.GetProperty("data").GetProperty("id").GetGuid();
        var addDeepVersion = addDeep.GetProperty("stateVersion").GetString();

        // Same key again: duplicate=true with the identical committed result
        // (same assignment id, same state version — the stored original reply).
        var addDeepDuplicate = await ToolCallAsync(client, TestToken, "reading_add_book", new
        {
            idempotencyKey = "e2e-add-deep",
            bookId = deepBookId.ToString(),
            mode = "Deep",
            makeDefault = true,
        });
        addDeepDuplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        addDeepDuplicate.GetProperty("data").GetProperty("id").GetGuid().Should().Be(deepAssignmentId);
        addDeepDuplicate.GetProperty("stateVersion").GetString().Should().Be(addDeepVersion);

        // A second Endurance assignment, added WITHOUT makeDefault: the flag
        // is optional and must not default to true.
        var addEndurance = await ToolCallAsync(client, TestToken, "reading_add_book", new
        {
            idempotencyKey = "e2e-add-endurance",
            bookId = enduranceBookId.ToString(),
            mode = "Endurance",
        });
        addEndurance.GetProperty("data").GetProperty("isDefault").GetBoolean().Should().BeFalse();
        var enduranceAssignmentId = addEndurance.GetProperty("data").GetProperty("id").GetGuid();

        // --- reading_set_default_book: exact assignment id + mode, no client
        // inference — the Endurance default switches to the new assignment ---
        var setDefault = await ToolCallAsync(client, TestToken, "reading_set_default_book", new
        {
            idempotencyKey = "e2e-set-default",
            bookAssignmentId = enduranceAssignmentId.ToString(),
            mode = "Endurance",
        });
        setDefault.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        setDefault.GetProperty("data").GetProperty("id").GetGuid().Should().Be(enduranceAssignmentId);
        setDefault.GetProperty("data").GetProperty("isDefault").GetBoolean().Should().BeTrue();
        var setDefaultVersion = setDefault.GetProperty("stateVersion").GetString();

        // --- REST sees the same book queue state, including the switched
        // Endurance default and the new Deep default ---
        using var booksResponse = await client.GetAsync("/api/reading-training/dashboard");
        booksResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var booksJson = JsonDocument.Parse(await booksResponse.Content.ReadAsStringAsync());
        booksJson.RootElement.GetProperty("stateVersion").GetString().Should().Be(setDefaultVersion);
        var books = booksJson.RootElement.GetProperty("data").GetProperty("books")
            .EnumerateArray().ToList();
        books.Single(b => b.GetProperty("id").GetGuid() == assignmentId)
            .GetProperty("isDefault").GetBoolean().Should().BeFalse("the Endurance default switched away");
        books.Single(b => b.GetProperty("id").GetGuid() == enduranceAssignmentId)
            .GetProperty("isDefault").GetBoolean().Should().BeTrue();
        books.Single(b => b.GetProperty("id").GetGuid() == deepAssignmentId)
            .GetProperty("isDefault").GetBoolean().Should().BeTrue();

        // --- reading_plan_session: fresh command, planned session ---
        var plan = await ToolCallAsync(client, TestToken, "reading_plan_session", new
        {
            idempotencyKey = "e2e-plan",
            bookAssignmentId = assignmentId.ToString(),
            mode = "Endurance",
            targetMinutes = 40,
        });
        plan.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        plan.GetProperty("reply").GetString().Should().NotBeNullOrEmpty();
        plan.GetProperty("stateVersion").GetString().Should().NotBeNullOrEmpty();
        plan.GetProperty("data").GetProperty("status").GetString().Should().Be("Planned");
        var sessionId = plan.GetProperty("data").GetProperty("id").GetGuid();
        var planVersion = plan.GetProperty("stateVersion").GetString();

        // Same key again: duplicate=true with the identical committed result
        // (same session id, same state version — the stored original reply).
        var planDuplicate = await ToolCallAsync(client, TestToken, "reading_plan_session", new
        {
            idempotencyKey = "e2e-plan",
            bookAssignmentId = assignmentId.ToString(),
            mode = "Endurance",
            targetMinutes = 40,
        });
        planDuplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        planDuplicate.GetProperty("data").GetProperty("id").GetGuid().Should().Be(sessionId);
        planDuplicate.GetProperty("stateVersion").GetString().Should().Be(planVersion);

        // --- reading_start_session: no sessionId → the open planned session ---
        var start = await ToolCallAsync(client, TestToken, "reading_start_session",
            new { idempotencyKey = "e2e-start" });
        start.GetProperty("data").GetProperty("status").GetString().Should().Be("Active");

        // --- reading_answer_now: the service's authoritative pause ---
        var answerNow = await ToolCallAsync(client, TestToken, "reading_answer_now",
            new { idempotencyKey = "e2e-answer" });
        answerNow.GetProperty("data").GetProperty("status").GetString().Should().Be("Paused");

        // --- reading_capture: verbatim text, type Question, explicit book ---
        const string verbatim = "  What is in our power?  ";
        var capture = await ToolCallAsync(client, TestToken, "reading_capture", new
        {
            idempotencyKey = "e2e-capture",
            text = verbatim,
            type = "Question",
            bookId = bookId.ToString(),
        });
        capture.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        var captureId = capture.GetProperty("data").GetProperty("id").GetGuid();
        capture.GetProperty("data").GetProperty("text").GetString().Should().Be(verbatim);
        capture.GetProperty("data").GetProperty("type").GetString().Should().Be("Question");
        // The capture is the last mutation of the session flow, so its state
        // version is the authoritative version the dashboard must report at
        // this point (the resolve step below moves the version forward).
        var sessionFlowVersion = capture.GetProperty("stateVersion").GetString();

        // Same capture key again: duplicate=true, same committed capture, and
        // no second row anywhere.
        var captureDuplicate = await ToolCallAsync(client, TestToken, "reading_capture", new
        {
            idempotencyKey = "e2e-capture",
            text = verbatim,
            type = "Question",
            bookId = bookId.ToString(),
        });
        captureDuplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        captureDuplicate.GetProperty("data").GetProperty("id").GetGuid().Should().Be(captureId);

        // --- REST inbox sees the capture exactly once, verbatim ---
        using var inboxResponse = await client.GetAsync("/api/reading-training/inbox");
        inboxResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var inboxJson = JsonDocument.Parse(await inboxResponse.Content.ReadAsStringAsync());
        var inboxRows = inboxJson.RootElement.GetProperty("data").EnumerateArray()
            .Where(c => c.GetProperty("id").GetGuid() == captureId).ToList();
        inboxRows.Should().ContainSingle();
        inboxRows[0].GetProperty("text").GetString().Should().Be(verbatim);
        inboxRows[0].GetProperty("type").GetInt32().Should().Be((int)ReadingCaptureType.Question);
        // No second row for the same key: exactly one capture with this text.
        inboxJson.RootElement.GetProperty("data").EnumerateArray()
            .Count(c => c.GetProperty("text").GetString() == verbatim).Should().Be(1);

        // --- REST dashboard sees the paused open session and the last state ---
        using var dashboardResponse = await client.GetAsync("/api/reading-training/dashboard");
        dashboardResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var dashJson = JsonDocument.Parse(await dashboardResponse.Content.ReadAsStringAsync());
        var openSession = dashJson.RootElement.GetProperty("data").GetProperty("openSession");
        openSession.GetProperty("id").GetGuid().Should().Be(sessionId);
        openSession.GetProperty("status").GetInt32().Should().Be((int)ReadingSessionStatus.Paused);
        dashJson.RootElement.GetProperty("stateVersion").GetString().Should().Be(sessionFlowVersion);

        // --- REST history only ever lists completed/cancelled sessions: the
        // paused session must not be fabricated into it ---
        using var historyResponse = await client.GetAsync("/api/reading-training/history");
        historyResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var historyJson = JsonDocument.Parse(await historyResponse.Content.ReadAsStringAsync());
        historyJson.RootElement.GetProperty("data").EnumerateArray()
            .Select(s => s.GetProperty("id").GetGuid()).Should().NotContain(sessionId);

        // --- reading_resolve_capture: keep=false dismisses the capture; the
        // capture id and action are forwarded verbatim for the server ---
        var resolve = await ToolCallAsync(client, TestToken, "reading_resolve_capture", new
        {
            idempotencyKey = "e2e-resolve-capture",
            captureId = captureId.ToString(),
            keep = false,
        });
        resolve.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        resolve.GetProperty("data").GetProperty("id").GetGuid().Should().Be(captureId);
        resolve.GetProperty("data").GetProperty("resolved").GetBoolean().Should().BeTrue();

        // Same key again: duplicate=true with the same committed capture.
        var resolveDuplicate = await ToolCallAsync(client, TestToken, "reading_resolve_capture", new
        {
            idempotencyKey = "e2e-resolve-capture",
            captureId = captureId.ToString(),
            keep = false,
        });
        resolveDuplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        resolveDuplicate.GetProperty("data").GetProperty("id").GetGuid().Should().Be(captureId);

        // The resolution is the last mutation, so its state version is the
        // authoritative version both REST and a fresh service scope report.
        var finalVersion = resolve.GetProperty("stateVersion").GetString();

        // --- REST inbox no longer lists the dismissed capture ---
        using var resolvedInboxResponse = await client.GetAsync("/api/reading-training/inbox");
        resolvedInboxResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var resolvedInboxJson = JsonDocument.Parse(await resolvedInboxResponse.Content.ReadAsStringAsync());
        resolvedInboxJson.RootElement.GetProperty("data").EnumerateArray()
            .Select(c => c.GetProperty("id").GetGuid()).Should().NotContain(captureId);

        // --- REST dashboard reports the resolution's state version ---
        using var finalDashboardResponse = await client.GetAsync("/api/reading-training/dashboard");
        finalDashboardResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var finalDashJson = JsonDocument.Parse(await finalDashboardResponse.Content.ReadAsStringAsync());
        finalDashJson.RootElement.GetProperty("stateVersion").GetString().Should().Be(finalVersion);

        // --- Fresh service scope over the same database: authoritative
        // service view and exactly one receipt per MCP key (no second row) ---
        using var freshScope = factory.Services.CreateScope();
        var freshDb = freshScope.ServiceProvider.GetRequiredService<NostosDbContext>();
        freshDb.ReadingCommandReceipts.Count(r =>
            r.ClientId == "nostos-mcp" && r.IdempotencyKey == "e2e-capture").Should().Be(1);
        freshDb.ReadingCommandReceipts.Count(r =>
            r.ClientId == "nostos-mcp" && r.IdempotencyKey == "e2e-plan").Should().Be(1);
        freshDb.ReadingCommandReceipts.Count(r =>
            r.ClientId == "nostos-mcp" && r.IdempotencyKey == "e2e-add-deep").Should().Be(1);
        freshDb.ReadingCommandReceipts.Count(r =>
            r.ClientId == "nostos-mcp" && r.IdempotencyKey == "e2e-add-endurance").Should().Be(1);
        freshDb.ReadingCommandReceipts.Count(r =>
            r.ClientId == "nostos-mcp" && r.IdempotencyKey == "e2e-set-default").Should().Be(1);
        freshDb.ReadingCommandReceipts.Count(r =>
            r.ClientId == "nostos-mcp" && r.IdempotencyKey == "e2e-resolve-capture").Should().Be(1);
        freshDb.ReadingCaptures.Count(c => c.Text == verbatim).Should().Be(1);
        freshDb.ReadingBookAssignments.Count(a =>
            a.BookId == deepBookId && a.Mode == ReadingMode.Deep).Should().Be(1);
        freshDb.ReadingBookAssignments.Count(a =>
            a.BookId == enduranceBookId && a.Mode == ReadingMode.Endurance).Should().Be(1);

        var service = freshScope.ServiceProvider.GetRequiredService<IReadingTrainingService>();
        var serviceDashboard = await service.GetDashboardAsync();
        var serviceDash = (ReadingDashboardDto)serviceDashboard.Data!;
        serviceDash.OpenSession.Should().NotBeNull();
        serviceDash.OpenSession!.Id.Should().Be(sessionId);
        serviceDash.OpenSession!.Status.Should().Be(ReadingSessionStatus.Paused);
        serviceDash.Programme.StateVersion.Should().Be(finalVersion);
        serviceDash.Books.Single(b => b.Id == assignmentId).IsDefault.Should().BeFalse();
        serviceDash.Books.Single(b => b.Id == enduranceAssignmentId).IsDefault.Should().BeTrue();
        serviceDash.Books.Single(b => b.Id == deepAssignmentId).IsDefault.Should().BeTrue();
    }

    [Fact]
    public async Task CustomSafePath_IsMapped_AndDefaultPathIsNot()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, path: "/custom-mcp", envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // The default path is neither gated nor mapped when a custom path is
        // configured: it falls through to the SPA fallback like any other
        // unknown route (method constraint 405 for non-GET).
        var fallback = await PostAsync(client, "/definitely-not-a-route", InitializeBody());
        fallback.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await PostAsync(client, "/mcp", InitializeBody())).StatusCode.Should().Be(fallback.StatusCode);

        // The configured path serves MCP with the token.
        (await PostWithAuth(client, TestToken, path: "/custom-mcp")).StatusCode.Should().Be(HttpStatusCode.OK);

        // Descendants of the configured path are gated.
        (await PostAsync(client, "/custom-mcp/anything", ToolsListBody())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task TrailingSlashInPath_IsNormalized()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, path: "/mcp/", envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var response = await PostWithAuth(client, TestToken);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("")]
    [InlineData("/")]
    [InlineData("mcp")]
    [InlineData("/mcp?x=1")]
    [InlineData("/mcp#fragment")]
    [InlineData("/mcp/*")]
    [InlineData("/mcp/{id}")]
    [InlineData("/mcp/../admin")]
    [InlineData("/mcp/./x")]
    [InlineData("/mcp//x")]
    [InlineData("/mcp/x ")]
    [InlineData("\\mcp")]
    public void InvalidPath_IsRejectedAtStartup(string path)
    {
        using var factory = new McpHttpFactory(enabled: true, path: path);
        var exception = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Messages(exception).Should().Contain(m => m.Contains("Mcp:Path", StringComparison.Ordinal));
    }

    [Fact]
    public void EmptyApiKeyEnvironmentVariableName_IsRejectedAtStartup()
    {
        using var factory = new McpHttpFactory(enabled: true, envVarName: "   ");
        var exception = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Messages(exception).Should().Contain(m => m.Contains("ApiKeyEnvironmentVariable", StringComparison.Ordinal));
    }

    [Fact]
    public async Task MaintenanceMode_Returns503_ForMcp_EvenWithValidToken()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var settingsProvider = factory.Services.GetRequiredService<BackupSettingsProvider>();
        settingsProvider.EnterMaintenanceMode();
        try
        {
            var response = await PostWithAuth(client, TestToken);
            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        }
        finally
        {
            settingsProvider.ExitMaintenanceMode();
        }
    }

    [Fact]
    public async Task NoTokenValue_AppearsInErrorsOrResponses()
    {
        const string wrongToken = "wrong-value-xyz";
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        foreach (var header in new[] { null, $"Bearer {wrongToken}", $"Bearer {TestToken} trailing", $"Basic {TestToken}" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
            {
                Content = InitializeBody(),
            };
            if (header is not null)
            {
                request.Headers.TryAddWithoutValidation("Authorization", header);
            }

            using var response = await client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            var body = await response.Content.ReadAsStringAsync();
            body.Should().NotContain(TestToken);
            body.Should().NotContain(wrongToken);
            response.Headers.WwwAuthenticate.ToString().Should().NotContain(TestToken);
        }
    }

    private static Task<HttpResponseMessage> PostWithAuth(
        HttpClient client,
        string token,
        string? scheme = null,
        string? header = null,
        string path = "/mcp",
        HttpContent? body = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = body ?? InitializeBody(),
        };
        request.Headers.TryAddWithoutValidation("Authorization", header ?? $"{scheme ?? "Bearer"} {token}");
        return SendMcpRequest(client, request);
    }

    private static Task<HttpResponseMessage> PostAsync(HttpClient client, string path, HttpContent body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = body };
        return SendMcpRequest(client, request);
    }

    // The Streamable HTTP transport requires an Accept header covering
    // application/json; without it the endpoint answers 406 Not Acceptable.
    private static Task<HttpResponseMessage> SendMcpRequest(HttpClient client, HttpRequestMessage request)
    {
        request.Headers.TryAddWithoutValidation("Accept", "application/json, text/event-stream");
        return client.SendAsync(request);
    }

    private static async Task<JsonDocument> ReadJsonRpcAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        if (response.Content.Headers.ContentType?.MediaType == "text/event-stream")
        {
            var dataLines = body
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Where(line => line.StartsWith("data:", StringComparison.Ordinal))
                .Select(line => line["data:".Length..].TrimStart());
            body = string.Join('\n', dataLines);
        }

        return JsonDocument.Parse(body);
    }

    private static StringContent InitializeBody()
    {
        var payload = new
        {
            jsonrpc = "2.0",
            id = 1,
            method = "initialize",
            @params = new
            {
                protocolVersion = "2025-06-18",
                capabilities = new { },
                clientInfo = new { name = "nostos-tests", version = "9a" },
            },
        };
        return JsonBody(payload);
    }

    private static StringContent ToolsListBody()
    {
        var payload = new
        {
            jsonrpc = "2.0",
            id = 2,
            method = "tools/list",
        };
        return JsonBody(payload);
    }

    // Invokes a tool over the real authenticated transport and returns the
    // parsed JSON of the tool's single text content block (the serialized
    // tool return value, i.e. the service envelope).
    private static async Task<JsonElement> ToolCallAsync(
        HttpClient client, string token, string name, object arguments)
    {
        var response = await PostWithAuth(client, token, body: ToolsCallBody(name, arguments));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var json = await ReadJsonRpcAsync(response);
        var result = json.RootElement.GetProperty("result");
        if (result.TryGetProperty("isError", out var isError))
        {
            isError.GetBoolean().Should().BeFalse($"tool {name} returned an error: {result}");
        }

        var content = result.GetProperty("content");
        content.GetArrayLength().Should().Be(1);
        content[0].GetProperty("type").GetString().Should().Be("text");
        var text = content[0].GetProperty("text").GetString()!;
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static StringContent ToolsCallBody(string name, object arguments)
    {
        var payload = new
        {
            jsonrpc = "2.0",
            id = 3,
            method = "tools/call",
            @params = new { name, arguments },
        };
        return JsonBody(payload);
    }

    private static StringContent JsonBody(object payload) => new(
        JsonSerializer.Serialize(payload),
        Encoding.UTF8,
        "application/json");

    private static IEnumerable<string> Messages(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            yield return current.Message;
        }
    }

    private static IDisposable SetEnvVar(string name, string? value)
    {
        var original = Environment.GetEnvironmentVariable(name);
        Environment.SetEnvironmentVariable(name, value);
        return new EnvVarRestore(name, original);
    }

    private sealed class EnvVarRestore(string name, string? original) : IDisposable
    {
        public void Dispose() => Environment.SetEnvironmentVariable(name, original);
    }
}
