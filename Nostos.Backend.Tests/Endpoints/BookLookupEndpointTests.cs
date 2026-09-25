using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

public sealed class BookLookupEndpointTests : IClassFixture<LibraryEndpointFactory>
{
    private const string Isbn = "9780141183848";
    private readonly LibraryEndpointFactory _factory;

    public BookLookupEndpointTests(LibraryEndpointFactory factory) => _factory = factory;

    [Fact]
    public async Task Invalid_isbn_returns_400_without_calling_providers()
    {
        var handler = new StubHttpMessageHandler();
        var lookupFactory = new StubHttpClientFactory(handler);

        await using var app = WithLookupFactory(lookupFactory);
        using var client = app.CreateClient();

        var response = await client.GetAsync("/api/books/lookup/not-an-isbn");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemCode(response)).Should().Be("invalid_isbn");
        handler.RecordedRequests.Should().BeEmpty();
    }

    [Fact]
    public async Task Working_providers_with_no_match_return_404()
    {
        var lookupFactory = Factory(request =>
            request.RequestUri?.Host switch
            {
                "openlibrary.org" => Json("{}"),
                "www.googleapis.com" => Json("""{"items":[]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            });

        await using var app = WithLookupFactory(lookupFactory);
        using var client = app.CreateClient();

        var response = await client.GetAsync($"/api/books/lookup/{Isbn}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ProblemCode(response)).Should().Be("book_metadata_not_found");
    }

    [Fact]
    public async Task Provider_failures_without_metadata_return_503()
    {
        var lookupFactory = Factory(request =>
            request.RequestUri?.Host switch
            {
                "openlibrary.org" => new HttpResponseMessage(HttpStatusCode.TooManyRequests),
                "www.googleapis.com" => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            });

        await using var app = WithLookupFactory(lookupFactory);
        using var client = app.CreateClient();

        var response = await client.GetAsync($"/api/books/lookup/{Isbn}");

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        (await ProblemCode(response)).Should().Be("book_metadata_unavailable");
    }

    [Fact]
    public async Task One_provider_can_succeed_while_the_other_fails()
    {
        var lookupFactory = Factory(request =>
            request.RequestUri?.Host switch
            {
                "openlibrary.org" => Json(OpenLibraryMatch),
                "www.googleapis.com" => new HttpResponseMessage(HttpStatusCode.InternalServerError),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            });

        await using var app = WithLookupFactory(lookupFactory);
        using var client = app.CreateClient();

        var response = await client.GetAsync($"/api/books/lookup/{Isbn}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var metadata = await response.Content.ReadFromJsonAsync<CreateBookDto>();
        metadata.Should().NotBeNull();
        metadata!.Title.Should().Be("Fictions");
    }

    private WebApplicationFactory<Program> WithLookupFactory(
        StubHttpClientFactory lookupFactory) =>
        _factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IHttpClientFactory>();
                services.AddSingleton<IHttpClientFactory>(lookupFactory);
            }));

    private static StubHttpClientFactory Factory(
        Func<HttpRequestMessage, HttpResponseMessage> responder) =>
        new(new StubHttpMessageHandler().SetFallback(responder));

    private static HttpResponseMessage Json(string json) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };

    private static async Task<string?> ProblemCode(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("code").GetString();
    }

    private const string OpenLibraryMatch =
        """
        {
          "ISBN:9780141183848": {
            "title": "Fictions",
            "authors": [{ "name": "Jorge Luis Borges" }]
          }
        }
        """;
}
