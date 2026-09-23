using FluentAssertions;
using Nostos.Backend.Services;
using Xunit;

namespace Nostos.Backend.Tests.Services;

public sealed class BookAssetFormatsTests
{
    [Theory]
    [InlineData("application/pdf", "book.pdf")]
    [InlineData("application/epub+zip", "book.epub")]
    [InlineData("text/plain; charset=utf-8", "book.txt")]
    [InlineData("audio/mpeg", "book.mp3")]
    [InlineData("audio/mp4", "book.m4a")]
    [InlineData("audio/mp4", "book.m4b")]
    [InlineData("application/x-mobipocket-ebook", "book.mobi")]
    [InlineData("application/x-mobipocket-ebook", "book.azw3")]
    [InlineData("application/octet-stream", "book.m4b")]
    [InlineData("", "book.epub")]
    public void Upload_accepts_supported_matching_media(string contentType, string fileName)
    {
        BookAssetFormats.IsAllowedUpload(contentType, fileName).Should().BeTrue();
    }

    [Theory]
    [InlineData("application/pdf", "book.epub")]
    [InlineData("audio/mpeg", "book.pdf")]
    [InlineData("application/epub+zip", "book.exe")]
    [InlineData("application/javascript", "book.pdf")]
    [InlineData("audio/mp4", "book.mp3")]
    public void Upload_rejects_mismatched_or_unsupported_media(string contentType, string fileName)
    {
        BookAssetFormats.IsAllowedUpload(contentType, fileName).Should().BeFalse();
    }

    [Theory]
    [InlineData("image/png", "cover.png", true)]
    [InlineData("image/jpeg", "cover.jpg", true)]
    [InlineData("image/jpeg", "cover.jpeg", true)]
    [InlineData("image/png", "cover.jpg", false)]
    [InlineData("image/jpeg", "cover.png", false)]
    [InlineData("image/png", "cover.txt", false)]
    public void Cover_upload_requires_matching_media_and_extension(
        string contentType,
        string fileName,
        bool expected)
    {
        BookAssetFormats.IsAllowedCoverUpload(contentType, fileName).Should().Be(expected);
    }
}
