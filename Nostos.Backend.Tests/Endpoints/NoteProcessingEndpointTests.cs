using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Services.Ai;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

/// <summary>
/// Full-host HTTP coverage for the note post-processing routes (issue #262 §7,
/// §8): reprocess, raw-transcript read, and restore.
///
/// The real 9Router free pool is NEVER called here. The host swaps the provider
/// for <see cref="FakeLlmProvider"/>, so the real <c>ThoughtProcessor</c> runs
/// over a scripted bridge — the same seam production uses, with no network.
/// </summary>
public sealed class NoteProcessingEndpointTests : IClassFixture<LibraryEndpointFactory>
{
    private readonly LibraryEndpointFactory _factory;

    public NoteProcessingEndpointTests(LibraryEndpointFactory factory) => _factory = factory;

    // ------------------------------------------------------------------
    // POST /api/notes/{id}/reprocess
    // ------------------------------------------------------------------

    [Fact]
    public async Task Reprocess_derives_the_text_from_the_raw_transcript_in_the_new_mode()
    {
        // The verbatim create calls no provider, so this single scripted answer
        // is the one the reprocess consumes.
        var provider = new FakeLlmProvider().Returns("A tightened thought.");

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var book = await CreateBookAsync(client);
        var note = await CreateNoteAsync(client, book.Id, "so anyway i was like thinking", "verbatim");

        // A second pass (clarify) must read the ORIGINAL transcript, never the
        // prose the first pass produced.

        var response = await client.PostAsJsonAsync(
            $"/api/notes/{note.Id}/reprocess", new { processingMode = "clarify" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var reprocessed = await response.Content.ReadFromJsonAsync<NoteDto>();

        reprocessed!.Content.Should().Be("A tightened thought.");
        reprocessed.RawContent.Should().Be("so anyway i was like thinking");
        reprocessed.ProcessingMode.Should().Be("clarify");

        // What the provider actually received was the raw transcript.
        provider.LastRequest.Messages[1].Content.Should().Be("so anyway i was like thinking");
    }

    [Fact]
    public async Task Reprocess_with_an_unknown_mode_is_a_typed_400_and_calls_no_provider()
    {
        var provider = new FakeLlmProvider();

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var book = await CreateBookAsync(client);
        var note = await CreateNoteAsync(client, book.Id, "raw words", "verbatim");

        var response = await client.PostAsJsonAsync(
            $"/api/notes/{note.Id}/reprocess", new { processingMode = "make_it_fancy" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ErrorAsync(response)).Should().Contain("make_it_fancy");
        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task Reprocess_an_unknown_note_is_a_404()
    {
        var provider = new FakeLlmProvider();

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/api/notes/{Guid.NewGuid()}/reprocess", new { processingMode = "clarify" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ErrorAsync(response)).Should().Be("Note not found.");
        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task A_provider_failure_during_reprocess_is_a_typed_502_not_a_500()
    {
        var provider = new FakeLlmProvider
        {
            Failure = LlmException.ProviderFailure("the pool is down"),
        };

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var book = await CreateBookAsync(client);
        var note = await CreateNoteAsync(client, book.Id, "raw words", "verbatim");

        var response = await client.PostAsJsonAsync(
            $"/api/notes/{note.Id}/reprocess", new { processingMode = "light_polish" });

        response.StatusCode.Should().Be(HttpStatusCode.BadGateway);
        (await ProblemTitleAsync(response)).Should().Be(LlmErrorCodes.Provider);

        // The note and its transcript are untouched by the failure.
        var raw = await client.GetFromJsonAsync<NoteRawTranscriptDto>($"/api/notes/{note.Id}/raw");
        raw!.Content.Should().Be("raw words");
    }

    // ------------------------------------------------------------------
    // GET /api/notes/{id}/raw + POST /api/notes/{id}/raw/restore
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_raw_transcript_reads_back_and_restore_puts_it_back()
    {
        var provider = new FakeLlmProvider().Returns("POLISHED");

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var book = await CreateBookAsync(client);
        var note = await CreateNoteAsync(client, book.Id, "raw words", "light_polish");

        note.ProcessingMode.Should().Be("light_polish");
        note.Content.Should().Be("POLISHED");
        note.RawContent.Should().Be("raw words");

        var raw = await client.GetFromJsonAsync<NoteRawTranscriptDto>($"/api/notes/{note.Id}/raw");
        raw!.RawContent.Should().Be("raw words");
        raw.Content.Should().Be("POLISHED");
        raw.ProcessingMode.Should().Be("light_polish");

        var restoredResponse = await client.PostAsync(
            $"/api/notes/{note.Id}/raw/restore", content: null);
        restoredResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var restored = await restoredResponse.Content.ReadFromJsonAsync<NoteDto>();
        restored!.Content.Should().Be("raw words");
        restored.ProcessingMode.Should().Be("verbatim");
        restored.RawContent.Should().Be("raw words", "restoring never erases the capture it restores from");
    }

    [Fact]
    public async Task Raw_of_a_note_with_no_transcript_reads_null_and_restore_is_a_409()
    {
        var provider = new FakeLlmProvider();

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var book = await CreateBookAsync(client);
        var note = await CreateNoteAsync(client, book.Id, "a plain typed note", "verbatim");

        var rawResponse = await client.GetAsync($"/api/notes/{note.Id}/raw");
        rawResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var raw = await rawResponse.Content.ReadFromJsonAsync<NoteRawTranscriptDto>();
        raw!.RawContent.Should().BeNull();

        var restoreResponse = await client.PostAsync(
            $"/api/notes/{note.Id}/raw/restore", content: null);
        restoreResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ErrorAsync(restoreResponse)).Should().Contain("no raw transcript");

        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task Raw_of_an_unknown_note_is_a_404()
    {
        var provider = new FakeLlmProvider();

        using var host = CreateHost(provider);
        using var client = host.CreateClient();

        var response = await client.GetAsync($"/api/notes/{Guid.NewGuid()}/raw");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ErrorAsync(response)).Should().Be("Note not found.");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private WebApplicationFactory<Program> CreateHost(FakeLlmProvider provider) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<ILlmProvider>();
                services.AddSingleton<ILlmProvider>(provider);
            });
        });

    private static async Task<BookDto> CreateBookAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/books", new
        {
            type = "physical",
            title = $"Processing Book {Guid.NewGuid():N}",
            author = "An Author",
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<BookDto>())!;
    }

    private static async Task<NoteDto> CreateNoteAsync(
        HttpClient client, Guid bookId, string content, string processingMode)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/books/{bookId}/notes", new { content, processingMode });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }

    private static async Task<string?> ErrorAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("error").GetString();
    }

    private static async Task<string?> ProblemTitleAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("title").GetString();
    }
}
