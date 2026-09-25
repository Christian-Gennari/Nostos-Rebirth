using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Providers.Discovery;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

public sealed class ProviderDiscoveryEndpointTests : IClassFixture<LibraryEndpointFactory>
{
    private readonly LibraryEndpointFactory _factory;

    public ProviderDiscoveryEndpointTests(LibraryEndpointFactory factory) => _factory = factory;

    [Fact]
    public async Task AggregateSearch_BindsKind_AndReturnsNormalizedItemsAndSourceStatuses()
    {
        var ebook = new EndpointProvider(
            "ebooks",
            ProviderCapabilities.EbookAcquisition,
            new ProviderSearchPage(
                [Item("ebooks", "shared", ProviderMediaKind.Ebook, "Ebook result")],
                Notice: "Ebook notice."));
        var audio = new EndpointProvider(
            "audio",
            ProviderCapabilities.AudiobookAcquisition,
            new ProviderSearchPage(
                [Item("audio", "shared", ProviderMediaKind.Audiobook, "Audio result")]));

        await using var app = _factory.WithWebHostBuilder(builder =>
            ReplaceProviders(builder, ebook, audio));
        using var client = app.CreateClient();

        var response = await client.GetFromJsonAsync<ProviderDiscoverySearchResultDto>(
            "/api/providers/search?query=classic&kind=ebook");

        response.Should().NotBeNull();
        response!.Items.Should().ContainSingle();
        response.Items[0].ProviderId.Should().Be("ebooks");
        response.Items[0].ExternalId.Should().Be("shared");
        response.Items[0].MediaKind.Should().Be("ebook");
        response.Items[0].Assets.Should().BeEmpty();
        response.Sources.Should().ContainSingle();
        response.Sources[0].ProviderId.Should().Be("ebooks");
        response.Sources[0].Succeeded.Should().BeTrue();
        response.Sources[0].Notice.Should().Be("Ebook notice.");
        ebook.SearchCount.Should().Be(1);
        audio.SearchCount.Should().Be(0);
    }

    [Fact]
    public async Task AggregateSearch_PreservesSiblingResultsWhenOneProviderFails()
    {
        var good = new EndpointProvider(
            "alpha",
            ProviderCapabilities.EbookAcquisition,
            new ProviderSearchPage([Item("alpha", "1", ProviderMediaKind.Ebook, "Good")]));
        var bad = new EndpointProvider(
            "beta",
            ProviderCapabilities.EbookAcquisition,
            ProviderException.UnavailableFor("beta", "test"));

        await using var app = _factory.WithWebHostBuilder(builder =>
            ReplaceProviders(builder, bad, good));
        using var client = app.CreateClient();

        var response = await client.GetFromJsonAsync<ProviderDiscoverySearchResultDto>(
            "/api/providers/search?query=classic");

        response.Should().NotBeNull();
        response!.Items.Should().ContainSingle();
        response.Items[0].ProviderId.Should().Be("alpha");
        response.Sources.Should().HaveCount(2);
        response.Sources.Single(source => source.ProviderId == "alpha").Succeeded.Should().BeTrue();
        var failure = response.Sources.Single(source => source.ProviderId == "beta");
        failure.Succeeded.Should().BeFalse();
        failure.ErrorCode.Should().Be(ProviderException.Unavailable);
    }

    [Fact]
    public async Task AggregateSearch_TimesOutHungProvider_AndReturnsSiblingResult()
    {
        var never = new TaskCompletionSource<ProviderSearchPage>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var good = new EndpointProvider(
            "alpha",
            ProviderCapabilities.EbookAcquisition,
            new ProviderSearchPage([Item("alpha", "1", ProviderMediaKind.Ebook, "Good")]));
        var hung = new EndpointProvider(
            "beta",
            ProviderCapabilities.EbookAcquisition,
            (_, _) => never.Task);

        await using var app = _factory.WithWebHostBuilder(builder =>
            ReplaceProviders(builder, TimeSpan.FromMilliseconds(60), good, hung));
        using var client = app.CreateClient();

        var response = await client
            .GetFromJsonAsync<ProviderDiscoverySearchResultDto>(
                "/api/providers/search?query=classic")
            .WaitAsync(TimeSpan.FromSeconds(2));

        response.Should().NotBeNull();
        response!.Items.Should().ContainSingle();
        response.Items[0].ProviderId.Should().Be("alpha");
        response.Sources.Should().HaveCount(2);
        response.Sources.Single(source => source.ProviderId == "alpha").Succeeded.Should().BeTrue();

        var timedOut = response.Sources.Single(source => source.ProviderId == "beta");
        timedOut.Succeeded.Should().BeFalse();
        timedOut.ErrorCode.Should().Be(ProviderDiscoveryErrorCodes.Timeout);
    }

    private static void ReplaceProviders(
        IWebHostBuilder builder,
        params IContentProvider[] providers) =>
        ReplaceProvidersCore(builder, searchTimeout: null, providers);

    private static void ReplaceProviders(
        IWebHostBuilder builder,
        TimeSpan searchTimeout,
        params IContentProvider[] providers) =>
        ReplaceProvidersCore(builder, searchTimeout, providers);

    private static void ReplaceProvidersCore(
        IWebHostBuilder builder,
        TimeSpan? searchTimeout,
        IReadOnlyList<IContentProvider> providers)
    {
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IContentProvider>();
            services.RemoveAll<IProviderRegistry>();
            services.RemoveAll<ProviderDiscoveryService>();

            foreach (var provider in providers)
                services.AddSingleton(typeof(IContentProvider), provider);

            if (searchTimeout is { } timeout)
            {
                services.Configure<ProviderDiscoveryOptions>(options =>
                    options.SearchTimeout = timeout);
            }

            services.AddSingleton<IProviderRegistry, ProviderRegistry>();
            services.AddSingleton<ProviderDiscoveryService>();
        });
    }

    private static ProviderItem Item(
        string providerId,
        string externalId,
        ProviderMediaKind kind,
        string title) =>
        new(
            ProviderId: providerId,
            ExternalId: externalId,
            MediaKind: kind,
            Metadata: new ProviderMetadata(title),
            Assets: []);

    private sealed class EndpointProvider :
        IContentProvider,
        IProviderSearch,
        IProviderAcquisitionPlanner,
        IProviderDownloadPolicy
    {
        private readonly Func<ProviderSearchQuery, CancellationToken, Task<ProviderSearchPage>> _search;

        public EndpointProvider(
            string id,
            ProviderCapabilities acquisition,
            ProviderSearchPage page)
            : this(id, acquisition, (_, _) => Task.FromResult(page))
        {
        }

        public EndpointProvider(
            string id,
            ProviderCapabilities acquisition,
            ProviderException failure)
            : this(
                id,
                acquisition,
                (_, _) => Task.FromException<ProviderSearchPage>(failure))
        {
        }

        public EndpointProvider(
            string id,
            ProviderCapabilities acquisition,
            Func<ProviderSearchQuery, CancellationToken, Task<ProviderSearchPage>> search)
        {
            Id = id;
            Capabilities = ProviderCapabilities.Search | acquisition;
            _search = search;
        }

        public string Id { get; }
        public string DisplayName => "Source " + Id;
        public ProviderCapabilities Capabilities { get; }
        public string? RightsNotice => null;
        public IReadOnlyList<string> AllowedHosts => ["example.com"];
        public long MaxBytesPerPart => 1;
        public long MaxTotalBytes => 1;
        public int MaxParts => 1;
        public int SearchCount { get; private set; }

        public Task<ProviderSearchPage> SearchAsync(ProviderSearchQuery query, CancellationToken ct)
        {
            SearchCount++;
            return _search(query, ct);
        }

        public Task<ProviderAcquisitionPlan?> PlanAcquisitionAsync(
            ProviderAcquisitionRequest request,
            CancellationToken ct) =>
            Task.FromResult<ProviderAcquisitionPlan?>(null);
    }
}
