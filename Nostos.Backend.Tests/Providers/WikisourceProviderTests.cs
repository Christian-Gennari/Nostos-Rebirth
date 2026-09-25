using System.Net;
using FluentAssertions;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Providers.Wikisource;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Providers;

public sealed class WikisourceProviderTests
{
    private static string LoadFixture(string filename)
    {
        var basePath = AppContext.BaseDirectory;
        var directPath = Path.Combine(basePath, "Fixtures", "wikisource", filename);
        if (File.Exists(directPath))
            return File.ReadAllText(directPath);

        var current = new DirectoryInfo(basePath);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "Fixtures", "wikisource", filename);
            if (File.Exists(candidate))
                return File.ReadAllText(candidate);

            var nestedCandidate = Path.Combine(
                current.FullName,
                "Nostos.Backend.Tests",
                "Fixtures",
                "wikisource",
                filename);
            if (File.Exists(nestedCandidate))
                return File.ReadAllText(nestedCandidate);

            current = current.Parent;
        }

        throw new FileNotFoundException("Wikisource fixture '" + filename + "' could not be located.");
    }

    private static (WikisourceProvider Provider, StubHttpMessageHandler Handler) CreateProvider()
    {
        var handler = new StubHttpMessageHandler();
        var factory = new StubHttpClientFactory(handler);
        return (new WikisourceProvider(factory), handler);
    }

    [Fact]
    public async Task CatalogParsing_NormalizesMetadataAssetsCoverAndRights()
    {
        var (provider, handler) = CreateProvider();
        handler.RegisterXml(WikisourceCatalog.CatalogPath, LoadFixture("ready-for-export.xml"));

        var result = await provider.SearchAsync(
            new ProviderSearchQuery("pride"),
            CancellationToken.None);

        result.Items.Should().ContainSingle();
        result.HasMore.Should().BeFalse();

        var item = result.Items.Single();
        item.ProviderId.Should().Be("wikisource");
        item.ExternalId.Should().Be("Pride and Prejudice");
        item.Metadata.Title.Should().Be("Pride and Prejudice");
        item.Metadata.Author.Should().Be("Jane Austen");
        item.Metadata.Language.Should().Be("English");
        item.Metadata.Categories.Should().Be("Fiction");
        item.Source.Should().NotBeNull();
        item.Source!.ItemUrl.Should().Be("https://en.wikisource.org/wiki/Pride_and_Prejudice");
        item.Source.RightsStatement.Should().Be("Public Domain");

        item.Assets.Should().ContainSingle();
        item.Assets[0].Id.Should().Be("epub");
        item.Assets[0].Kind.Should().Be(ProviderMediaKind.Ebook);
        item.Assets[0].SourceFormat.Should().Be("application/epub+zip");
        item.Assets[0].IsPreferred.Should().BeTrue();

        item.Cover.Should().NotBeNull();
        item.Cover!.Url.Should().Be(new Uri("https://thumb.wikimedia.org/example/pride.jpg"));
        item.Cover.ContentType.Should().Be("image/jpeg");
        item.Cover.FileExtension.Should().Be(".jpg");
    }

    [Fact]
    public async Task Search_FiltersCatalogLocally_ByTitleAuthorAndCategory_AndPaginates()
    {
        var xml = LoadFixture("ready-for-export.xml");
        var (provider, handler) = CreateProvider();
        handler.SetFallback(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(xml, System.Text.Encoding.UTF8, "application/atom+xml"),
        });

        var author = await provider.SearchAsync(
            new ProviderSearchQuery("austen"),
            CancellationToken.None);
        author.Items.Select(item => item.Metadata.Title).Should().Equal("Pride and Prejudice");

        var category = await provider.SearchAsync(
            new ProviderSearchQuery("essay"),
            CancellationToken.None);
        category.Items.Select(item => item.Metadata.Title).Should().Equal("A Modern Essay");

        var page = await provider.SearchAsync(
            new ProviderSearchQuery("", Limit: 1, Offset: 1),
            CancellationToken.None);
        page.Items.Should().ContainSingle();
        page.Items[0].Metadata.Title.Should().Be("A Modern Essay");
        page.HasMore.Should().BeTrue();

        var audioOnly = await provider.SearchAsync(
            new ProviderSearchQuery("pride", Kind: ProviderMediaKind.Audiobook),
            CancellationToken.None);
        audioOnly.Items.Should().BeEmpty();
        handler.RecordedRequests.Should().HaveCount(3);
    }

    [Fact]
    public async Task Detail_PreservesAtomRightsVerbatim_AndUsesSingleItemEndpoint()
    {
        var (provider, handler) = CreateProvider();
        handler.RegisterXml(
            "/?lang=en&format=atom&page=Pride%20and%20Prejudice",
            LoadFixture("item-pride-and-prejudice.atom"));

        var item = await provider.GetItemAsync("Pride and Prejudice", CancellationToken.None);

        item.Should().NotBeNull();
        item!.Source!.RightsStatement.Should().Be("CC-BY-SA 3.0");
        handler.RecordedRequestPaths.Should().ContainSingle(
            "/?lang=en&format=atom&page=Pride%20and%20Prejudice");
    }

    [Fact]
    public async Task PlanAcquisition_ResolvesPublishedEpubLink_WithoutLeakingProviderShape()
    {
        var (provider, handler) = CreateProvider();
        handler.RegisterXml(
            "/?lang=en&format=atom&page=Pride%20and%20Prejudice",
            LoadFixture("item-pride-and-prejudice.atom"));

        var plan = await provider.PlanAcquisitionAsync(
            new ProviderAcquisitionRequest("Pride and Prejudice", AssetId: null),
            CancellationToken.None);

        plan.Should().NotBeNull();
        plan!.ProviderId.Should().Be("wikisource");
        plan.ExternalId.Should().Be("Pride and Prejudice");
        plan.Asset.Id.Should().Be("epub");
        plan.Asset.Kind.Should().Be(ProviderMediaKind.Ebook);
        plan.Parts.Should().ContainSingle();
        plan.Parts[0].Url.Should().Be(
            new Uri("https://ws-export.wmcloud.org/?lang=en&format=epub&page=Pride%20and%20Prejudice"));
        plan.Parts[0].FileExtension.Should().Be(".epub");
        plan.Output.Should().Be(new ProviderOutput(".epub", "application/epub+zip", "EPUB"));
        plan.Source!.RightsStatement.Should().Be("CC-BY-SA 3.0");
    }

    [Fact]
    public async Task PlanAcquisition_UnknownAsset_ThrowsStableProviderError()
    {
        var (provider, handler) = CreateProvider();
        handler.RegisterXml(
            "/?lang=en&format=atom&page=Pride%20and%20Prejudice",
            LoadFixture("item-pride-and-prejudice.atom"));

        var act = async () => await provider.PlanAcquisitionAsync(
            new ProviderAcquisitionRequest("Pride and Prejudice", AssetId: "pdf"),
            CancellationToken.None);

        var error = await act.Should().ThrowAsync<ProviderException>();
        error.Which.Code.Should().Be(ProviderException.AssetUnavailable);
    }

    [Fact]
    public async Task InvalidExternalId_IsRejectedBeforeHttp()
    {
        var (provider, handler) = CreateProvider();

        var item = await provider.GetItemAsync(new string('a', 513), CancellationToken.None);

        item.Should().BeNull();
        handler.RecordedRequests.Should().BeEmpty();
    }

    [Fact]
    public async Task NonAtomResponse_IsReportedAsInvalidProviderResponse()
    {
        var (provider, handler) = CreateProvider();
        handler.Register(
            WikisourceCatalog.CatalogPath,
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "<html><body>maintenance</body></html>",
                    System.Text.Encoding.UTF8,
                    "text/html"),
            });

        var act = async () => await provider.SearchAsync(
            new ProviderSearchQuery("pride"),
            CancellationToken.None);

        var error = await act.Should().ThrowAsync<ProviderException>();
        error.Which.Code.Should().Be(ProviderException.ResponseInvalid);
    }

    [Fact]
    public void PolicyAndRegistration_UseOnlySpecifiedHostsAndSingleEpubPart()
    {
        var (provider, _) = CreateProvider();

        provider.AllowedHosts.Should().Equal(
            "ws-export.wmcloud.org",
            "upload.wikimedia.org",
            "thumb.wikimedia.org");
        provider.MaxParts.Should().Be(1);
        provider.MaxBytesPerPart.Should().Be(provider.MaxTotalBytes);

        ProviderHostPolicy.IsAllowed("ws-export.wmcloud.org", provider.AllowedHosts).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("upload.wikimedia.org", provider.AllowedHosts).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("thumb.wikimedia.org", provider.AllowedHosts).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("en.wikisource.org", provider.AllowedHosts).Should().BeFalse();
        ProviderHostPolicy.IsAllowed("example.com", provider.AllowedHosts).Should().BeFalse();

        provider.Capabilities.Should().HaveFlag(ProviderCapabilities.Search);
        provider.Capabilities.Should().HaveFlag(ProviderCapabilities.ItemRetrieval);
        provider.Capabilities.Should().HaveFlag(ProviderCapabilities.EbookAcquisition);
        provider.Capabilities.Should().HaveFlag(ProviderCapabilities.CoverArt);
        provider.Capabilities.Should().HaveFlag(ProviderCapabilities.RightsInformation);
        provider.Capabilities.Should().NotHaveFlag(ProviderCapabilities.AudiobookAcquisition);
        provider.Capabilities.Should().NotHaveFlag(ProviderCapabilities.RequiresAssembly);
        provider.RightsNotice.Should().BeNull();

        var registry = new ProviderRegistry(new IContentProvider[] { provider });
        registry.Find(WikisourceProvider.ProviderIdentifier).Should().NotBeNull();
    }
}
