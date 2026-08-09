using System.Net;
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
using Nostos.Backend.Services;
using Nostos.Backend.Tests.ReadingTraining;
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
        // Task 9A registers only the static, non-domain identity tool; Task 9B
        // adds the Reading Training tool surface. The protocol-level
        // tools/list call below verifies discovery over the real transport.

        var toolsList = await PostWithAuth(client, TestToken, body: ToolsListBody());
        toolsList.StatusCode.Should().Be(HttpStatusCode.OK);

        using var listJson = await ReadJsonRpcAsync(toolsList);
        var hasResult = listJson.RootElement.TryGetProperty("result", out var listResult);
        hasResult.Should().BeTrue($"tools/list response was {listJson.RootElement.GetRawText()}");
        var hasTools = listResult.TryGetProperty("tools", out var tools);
        hasTools.Should().BeTrue($"tools/list response was {listJson.RootElement.GetRawText()}");
        tools.ValueKind.Should().Be(JsonValueKind.Array);
        tools.GetArrayLength().Should().Be(1);
        tools[0].GetProperty("name").GetString().Should().Be("nostos_server_info");
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
