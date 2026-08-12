using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Xunit;

namespace Nostos.Backend.Tests.Mcp;

// Real authenticated MCP transport tests for the library tool surface
// (issue #34 Phase 2). Discovery asserts the exact 5-tool manifest on top of
// the 23 reading tools; tools/call proves create-or-match, exact-once replay,
// resolution, and REST/MCP state convergence over the same database.
[Collection("McpEnvironment")]
public sealed class LibraryMcpHttpTests
{
    private const string TestToken = "t9a-super-secret-token";
    private const string TestEnvVar = "NOSTOS_MCP_TOKEN_T9A";

    private static readonly string[] LibraryReadNames =
    [
        "library_list_books",
        "library_get_book",
        "library_resolve_book",
        "library_list_collections",
        "library_get_collection",
    ];

    private static readonly string[] LibraryMutationNames =
    [
        "library_create_or_match_book",
        "library_update_book",
        "library_create_collection",
        "library_rename_collection",
        "library_move_collection",
        "library_delete_collection",
    ];

    [Fact]
    public async Task Discovery_ExposesLibrarySurface_WithReadOnlyHintsAndRequiredKeys()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var tools = await ListToolsAsync(client);

        var names = tools.EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        names.Should().HaveCount(34, "23 reading tools + 11 library tools");
        names.Should().Contain(LibraryReadNames);
        names.Should().Contain(LibraryMutationNames);

        var byName = tools.EnumerateArray().ToDictionary(t => t.GetProperty("name").GetString()!);

        foreach (var readName in LibraryReadNames)
        {
            var annotations = byName[readName].GetProperty("annotations");
            annotations.GetProperty("readOnlyHint").GetBoolean().Should().BeTrue($"{readName} is read-only");
            byName[readName].TryGetProperty("inputSchema", out _).Should().BeTrue();
        }

        foreach (var mutationName in LibraryMutationNames)
        {
            var schema = byName[mutationName].GetProperty("inputSchema");
            var properties = schema.GetProperty("properties");
            var key = properties.GetProperty("idempotencyKey");
            var required = schema.GetProperty("required").EnumerateArray().Select(r => r.GetString()).ToList();
            required.Should().Contain("idempotencyKey", $"{mutationName} requires a caller-supplied key");
            key.TryGetProperty("default", out _).Should().BeFalse("no default key may exist");
        }
    }

    [Fact]
    public async Task CreateOrMatch_Creates_ReplaysDuplicate_AndMatchesByIdentity()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var created = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-create-1",
            type = "physical",
            title = "Fictions (MCP)",
            author = "Jorge Luis Borges",
            isbn = "9780141183848",
        });
        created.GetProperty("data").GetProperty("outcome").GetString().Should().Be("created");
        var bookId = created.GetProperty("data").GetProperty("bookId").GetString();
        created.GetProperty("stateVersion").GetString().Should().Be("1");

        // Same key: exact-once replay, duplicate=true, no second row.
        var replay = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-create-1",
            type = "physical",
            title = "Fictions (MCP)",
            author = "Jorge Luis Borges",
            isbn = "9780141183848",
        });
        replay.GetProperty("duplicate").GetBoolean().Should().BeTrue();
        replay.GetProperty("data").GetProperty("bookId").GetString().Should().Be(bookId);

        // Same ISBN, new key: matched, not created, no version bump.
        var matched = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-create-2",
            type = "physical",
            title = "Fictions (different title)",
            isbn = "9780141183848",
        });
        matched.GetProperty("data").GetProperty("outcome").GetString().Should().Be("matched");
        matched.GetProperty("data").GetProperty("bookId").GetString().Should().Be(bookId);
        matched.GetProperty("stateVersion").GetString().Should().Be("1");
        matched.GetProperty("duplicate").GetBoolean().Should().BeFalse("matching is not receipt replay");

        // REST sees the same canonical row.
        var rest = await client.GetFromJsonAsync<PaginatedResponseDto>("/api/books?search=Fictions");
        rest.TotalCount.Should().Be(1);
    }

    [Fact]
    public async Task CreateOrMatch_AmbiguousTitle_ReturnsConfirmationRequired_AndConfirmedFlowWorks()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // Two same-title/author editions seeded via REST (permissive path).
        var first = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-amb-1",
            type = "physical",
            title = "Meditations",
            author = "Marcus Aurelius",
        });
        var firstId = first.GetProperty("data").GetProperty("bookId").GetString();

        // Seed a second same-title/author edition DIRECTLY in the database
        // (the canonical service deliberately dedupes exact title+author, so
        // a duplicate can only exist through a pre-service path).
        var dbOptions = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={factory.DatabasePath}").Options;
        await using (var db = new NostosDbContext(dbOptions))
        {
            await db.Database.OpenConnectionAsync();
            db.PhysicalBooks.Add(new PhysicalBookModel
            {
                Id = Guid.NewGuid(),
                Title = "Meditations",
                Author = "Marcus Aurelius",
                Metadata = new BookMetadata { Edition = "Different" },
            });
            await db.SaveChangesAsync();
        }

        // Ambiguity over MCP: confirmation_required with candidates.
        var ambiguous = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-amb-2",
            type = "physical",
            title = "Meditations",
            author = "Marcus Aurelius",
        });
        ambiguous.GetProperty("data").GetProperty("code").GetString().Should().Be("confirmation_required");
        ambiguous.GetProperty("data").GetProperty("candidates").GetArrayLength().Should().Be(2);

        // Confirmed flow with a NEW key resolves to the chosen book.
        var confirmed = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-amb-3",
            type = "physical",
            title = "Meditations",
            author = "Marcus Aurelius",
            confirmedBookId = firstId,
        });
        confirmed.GetProperty("data").GetProperty("outcome").GetString().Should().Be("matched");
        confirmed.GetProperty("data").GetProperty("bookId").GetString().Should().Be(firstId);
    }

    [Fact]
    public async Task ResolveBook_FindsExactMatch_AndReportsCandidates()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var notFound = await ToolCallAsync(client, TestToken, "library_resolve_book", new
        {
            isbn = "9780141183848",
            includeExternalMetadata = false,
        });
        notFound.GetProperty("resolution").GetString().Should().Be("NotFound");

        var created = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-res-1",
            type = "physical",
            title = "The Republic",
            author = "Plato",
            isbn = "9780141183848",
        });
        _ = created;

        var exact = await ToolCallAsync(client, TestToken, "library_resolve_book", new
        {
            isbn = "978-0-141-18384-8",
            includeExternalMetadata = false,
        });
        exact.GetProperty("resolution").GetString().Should().Be("ExactMatch");
        exact.GetProperty("matchedBook").GetProperty("title").GetString().Should().Be("The Republic");

        var byTitle = await ToolCallAsync(client, TestToken, "library_resolve_book", new
        {
            title = "the republic",
            author = "plato",
        });
        byTitle.GetProperty("resolution").GetString().Should().Be("ExactMatch");
    }

    [Fact]
    public async Task UpdateBook_AppliesChanges_AndRejectsIdentifierConflicts()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var created = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-upd-1",
            type = "physical",
            title = "Update Me",
            author = "Old",
        });
        var bookId = created.GetProperty("data").GetProperty("bookId").GetString();

        var updated = await ToolCallAsync(client, TestToken, "library_update_book", new
        {
            idempotencyKey = "mcp-upd-2",
            bookId,
            author = "New Author",
            subtitle = "",
        });
        updated.GetProperty("data").GetProperty("author").GetString().Should().Be("New Author");
        // The MCP transport omits null-valued fields, so a cleared subtitle
        // is ABSENT on the wire rather than explicitly null.
        updated.GetProperty("data").TryGetProperty("subtitle", out _).Should().BeFalse("subtitle was cleared");

        // Another book holds this ISBN → duplicate_identifier.
        await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-upd-3",
            type = "physical",
            title = "Other Book",
            author = "Other",
            isbn = "9780141183848",
        });
        var conflict = await ToolCallAsync(client, TestToken, "library_update_book", new
        {
            idempotencyKey = "mcp-upd-4",
            bookId,
            isbn = "9780141183848",
        });
        conflict.GetProperty("data").GetProperty("code").GetString().Should().Be("duplicate_identifier");
    }

    [Fact]
    public async Task GetBook_And_ListBooks_MatchRestState()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var created = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-list-1",
            type = "physical",
            title = "Listable Book",
            author = "Author X",
        });
        var bookId = created.GetProperty("data").GetProperty("bookId").GetString();

        var get = await ToolCallAsync(client, TestToken, "library_get_book", new { bookId });
        get.GetProperty("data").GetProperty("title").GetString().Should().Be("Listable Book");

        var list = await ToolCallAsync(client, TestToken, "library_list_books", new { search = "Listable", pageSize = 10 });
        list.GetProperty("data").GetProperty("totalCount").GetInt32().Should().Be(1);

        var missing = await ToolCallAsync(client, TestToken, "library_get_book", new { bookId = Guid.NewGuid().ToString() });
        missing.GetProperty("data").GetProperty("code").GetString().Should().Be("book_not_found");
    }

    [Fact]
    public async Task Collections_LifecycleOverTransport()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        // Create parent + duplicate sibling name → existing returned.
        var parent = await ToolCallAsync(client, TestToken, "library_create_collection", new
        {
            idempotencyKey = "mcp-col-1",
            name = "Philosophy",
        });
        var parentId = parent.GetProperty("data").GetProperty("id").GetString();

        var dup = await ToolCallAsync(client, TestToken, "library_create_collection", new
        {
            idempotencyKey = "mcp-col-2",
            name = "philosophy",
        });
        dup.GetProperty("data").GetProperty("id").GetString().Should().Be(parentId);
        dup.GetProperty("reply").GetString().Should().Contain("already exists");

        // Create child, then move cycle rejection.
        var child = await ToolCallAsync(client, TestToken, "library_create_collection", new
        {
            idempotencyKey = "mcp-col-3",
            name = "Ancient",
            parentId,
        });
        var childId = child.GetProperty("data").GetProperty("id").GetString();

        var cycle = await ToolCallAsync(client, TestToken, "library_move_collection", new
        {
            idempotencyKey = "mcp-col-4",
            collectionId = parentId,
            newParentId = childId,
        });
        cycle.GetProperty("data").GetProperty("code").GetString().Should().Be("collection_cycle");

        // Delete without confirm and with children are both rejected.
        var noConfirm = await ToolCallAsync(client, TestToken, "library_delete_collection", new
        {
            idempotencyKey = "mcp-col-5",
            collectionId = parentId,
            confirm = false,
        });
        noConfirm.GetProperty("data").GetProperty("code").GetString().Should().Be("confirmation_required");

        var hasChildren = await ToolCallAsync(client, TestToken, "library_delete_collection", new
        {
            idempotencyKey = "mcp-col-6",
            collectionId = parentId,
            confirm = true,
        });
        hasChildren.GetProperty("data").GetProperty("code").GetString().Should().Be("collection_has_children");

        // Rename + verified move to root.
        var renamed = await ToolCallAsync(client, TestToken, "library_rename_collection", new
        {
            idempotencyKey = "mcp-col-7",
            collectionId = childId,
            name = "Ancient Thought",
        });
        renamed.GetProperty("data").GetProperty("name").GetString().Should().Be("Ancient Thought");

        // Moved to root: parentId is absent on the wire (null values are
        // omitted by the MCP transport).
        var moved = await ToolCallAsync(client, TestToken, "library_move_collection", new
        {
            idempotencyKey = "mcp-col-8",
            collectionId = childId,
            newParentId = (string?)null,
        });
        moved.GetProperty("data").TryGetProperty("parentId", out _).Should().BeFalse("moved to root");

        // Delete child (no children), then parent (unlinks nothing but goes).
        var childDeleted = await ToolCallAsync(client, TestToken, "library_delete_collection", new
        {
            idempotencyKey = "mcp-col-9",
            collectionId = childId,
            confirm = true,
        });
        childDeleted.GetProperty("data").GetProperty("booksUnlinked").GetInt32().Should().Be(0);

        var parentDeleted = await ToolCallAsync(client, TestToken, "library_delete_collection", new
        {
            idempotencyKey = "mcp-col-10",
            collectionId = parentId,
            confirm = true,
        });
        parentDeleted.GetProperty("data").GetProperty("booksUnlinked").GetInt32().Should().Be(0);

        var list = await ToolCallAsync(client, TestToken, "library_list_collections", new { });
        list.GetProperty("data").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task DeleteCollection_UnlinksBooks_NotDeletes()
    {
        using var env = SetEnvVar(TestEnvVar, TestToken);
        using var factory = new McpHttpFactory(enabled: true, envVarName: TestEnvVar);
        using var client = factory.CreateClient();

        var collection = await ToolCallAsync(client, TestToken, "library_create_collection", new
        {
            idempotencyKey = "mcp-unlink-1",
            name = "TBR Shelf",
        });
        var collectionId = collection.GetProperty("data").GetProperty("id").GetString();

        var book = await ToolCallAsync(client, TestToken, "library_create_or_match_book", new
        {
            idempotencyKey = "mcp-unlink-2",
            type = "physical",
            title = "Unlink Me",
            author = "Author",
            collectionId,
        });
        var bookId = book.GetProperty("data").GetProperty("bookId").GetString();

        var deleted = await ToolCallAsync(client, TestToken, "library_delete_collection", new
        {
            idempotencyKey = "mcp-unlink-3",
            collectionId,
            confirm = true,
        });
        deleted.GetProperty("data").GetProperty("booksUnlinked").GetInt32().Should().Be(1);

        // The book survives, unlinked (collectionId absent on the wire).
        var after = await ToolCallAsync(client, TestToken, "library_get_book", new { bookId });
        after.GetProperty("data").TryGetProperty("collectionId", out _).Should().BeFalse("book unlinked");
    }

    // ------------------------------------------------------------------
    // Transport helpers (mirror of McpHttpTests)
    // ------------------------------------------------------------------

    private static async Task<JsonElement> ListToolsAsync(HttpClient client)
    {
        var response = await PostWithAuth(client, TestToken, body: ToolsListBody());
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = await ReadJsonRpcAsync(response);
        return json.RootElement.GetProperty("result").GetProperty("tools").Clone();
    }

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

    private static async Task<HttpResponseMessage> PostWithAuth(
        HttpClient client,
        string token,
        string? scheme = "Bearer",
        string? header = null,
        StringContent? body = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = body ?? InitializeBody(),
        };
        // MCP Streamable HTTP requires an Accept header covering
        // application/json AND text/event-stream; a bare JSON value still
        // answers 406.
        request.Headers.TryAddWithoutValidation("Accept", "application/json, text/event-stream");
        if (header is not null)
        {
            request.Headers.TryAddWithoutValidation("Authorization", header);
        }
        else
        {
            request.Headers.TryAddWithoutValidation("Authorization", $"{scheme} {token}");
        }

        return await client.SendAsync(request);
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
                protocolVersion = "2025-03-26",
                capabilities = new { },
                clientInfo = new { name = "test", version = "1.0" },
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

    private sealed class PaginatedResponseDto
    {
        public int TotalCount { get; set; }
    }
}
