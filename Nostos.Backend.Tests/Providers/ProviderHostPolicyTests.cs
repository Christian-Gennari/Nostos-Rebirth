using FluentAssertions;
using Nostos.Backend.Providers.Acquisition;
using Xunit;

namespace Nostos.Backend.Tests.Providers;

public sealed class ProviderHostPolicyTests
{
    [Fact]
    public void IsAllowed_ExactHostMatch_ReturnsTrue()
    {
        var allowed = new[] { "archive.org" };

        ProviderHostPolicy.IsAllowed("archive.org", allowed).Should().BeTrue();
    }

    [Fact]
    public void IsAllowed_SubdomainSuffixMatch_ForMultiLevelSubdomain_ReturnsTrue()
    {
        var allowed = new[] { "archive.org" };

        ProviderHostPolicy.IsAllowed("ia801600.us.archive.org", allowed).Should().BeTrue();
    }

    [Fact]
    public void IsAllowed_CaseInsensitiveMatching_ReturnsTrue()
    {
        var allowed = new[] { "Archive.Org" };

        ProviderHostPolicy.IsAllowed("IA801600.US.ARCHIVE.ORG", allowed).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("archive.org", allowed).Should().BeTrue();
    }

    [Fact]
    public void IsAllowed_UnrelatedHost_ReturnsFalse()
    {
        var allowed = new[] { "archive.org" };

        ProviderHostPolicy.IsAllowed("example.com", allowed).Should().BeFalse();
        ProviderHostPolicy.IsAllowed("gutenberg.org", allowed).Should().BeFalse();
    }

    [Fact]
    public void IsAllowed_HostMerelyEndingWithAllowedString_NotSubdomain_ReturnsFalse()
    {
        var allowed = new[] { "archive.org" };

        ProviderHostPolicy.IsAllowed("notarchive.org", allowed).Should().BeFalse();
        ProviderHostPolicy.IsAllowed("fakearchive.org", allowed).Should().BeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void IsAllowed_EmptyOrWhitespaceHost_ReturnsFalse(string? host)
    {
        var allowed = new[] { "archive.org" };

        ProviderHostPolicy.IsAllowed(host, allowed).Should().BeFalse();
    }

    [Theory]
    [InlineData("*.archive.org")]
    [InlineData(".archive.org")]
    [InlineData("archive.org")]
    public void IsAllowed_WildcardOrDotPrefixEntry_BehavesIdentically(string entry)
    {
        var allowed = new[] { entry };

        ProviderHostPolicy.IsAllowed("archive.org", allowed).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("ia801600.us.archive.org", allowed).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("sub.archive.org", allowed).Should().BeTrue();
        ProviderHostPolicy.IsAllowed("notarchive.org", allowed).Should().BeFalse();
    }

    [Fact]
    public void IsAllowed_EmptyAllowList_RejectsEverything()
    {
        var emptyList = Array.Empty<string>();

        ProviderHostPolicy.IsAllowed("archive.org", emptyList).Should().BeFalse();
        ProviderHostPolicy.IsAllowed("localhost", emptyList).Should().BeFalse();
        ProviderHostPolicy.IsAllowed("example.com", emptyList).Should().BeFalse();
    }

    [Fact]
    public void IsAllowed_AllowListWithOnlyEmptyOrWhitespaceEntries_RejectsEverything()
    {
        var whitespaceList = new[] { "", "   ", "*", ".", "*.", ".*" };

        ProviderHostPolicy.IsAllowed("archive.org", whitespaceList).Should().BeFalse();
    }

    [Fact]
    public void IsAllowedScheme_HttpsAllowed()
    {
        var uri = new Uri("https://archive.org/download/item/file.epub");

        ProviderHostPolicy.IsAllowedScheme(uri).Should().BeTrue();
    }

    [Fact]
    public void IsAllowedScheme_HttpRejected()
    {
        var uri = new Uri("http://archive.org/download/item/file.epub");

        ProviderHostPolicy.IsAllowedScheme(uri).Should().BeFalse();
    }

    [Fact]
    public void IsAllowedScheme_FtpRejected()
    {
        var uri = new Uri("ftp://archive.org/download/item/file.epub");

        ProviderHostPolicy.IsAllowedScheme(uri).Should().BeFalse();
    }
}
