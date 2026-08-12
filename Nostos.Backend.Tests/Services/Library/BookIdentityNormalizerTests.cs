using FluentAssertions;
using Nostos.Backend.Services.Library;
using Xunit;

namespace Nostos.Backend.Tests.Services.Library;

public sealed class BookIdentityNormalizerTests
{
    // --- ISBN ---

    [Theory]
    [InlineData("9780141183848")]
    [InlineData("978-0-141-18384-8")]
    [InlineData("978 0 141 18384 8")]
    [InlineData("9780141183848 ")]
    public void NormalizeIsbn_valid_isbn13_returns_canonical(string input) =>
        BookIdentityNormalizer.NormalizeIsbn(input).Should().Be("9780141183848");

    [Theory]
    [InlineData("0141183845")]
    [InlineData("0-141-18384-5")]
    [InlineData("080442957x")]
    [InlineData("080442957X")]
    public void NormalizeIsbn_valid_isbn10_returns_canonical_uppercase_x(string input) =>
        BookIdentityNormalizer.NormalizeIsbn(input).Should().Be(input.Contains('X') || input.Contains('x') ? "080442957X" : "0141183845");

    [Theory]
    [InlineData("9780141183849")] // bad ISBN-13 checksum
    [InlineData("0141183841")]    // bad ISBN-10 checksum
    [InlineData("0141183840")]    // bad ISBN-10 checksum
    [InlineData("978014118384")]  // too short
    [InlineData("97801411838481")]// too long
    [InlineData("978014118384Y")] // non-digit terminal
    [InlineData("abcdefghij")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void NormalizeIsbn_invalid_returns_null(string? input) =>
        BookIdentityNormalizer.NormalizeIsbn(input).Should().BeNull();

    // --- ASIN ---

    [Theory]
    [InlineData("B095TNRPXD")]
    [InlineData("b095tnrpxd")]
    [InlineData(" B095TNRPXD ")]
    public void NormalizeAsin_valid_returns_uppercased(string input) =>
        BookIdentityNormalizer.NormalizeAsin(input).Should().Be("B095TNRPXD");

    [Theory]
    [InlineData("B095TNRPX")]    // 9 chars
    [InlineData("B095TNRPXD1")]  // 11 chars
    [InlineData("B095TNRPXD!")]  // invalid char
    [InlineData("095TNRPXD!")]   // invalid char
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void NormalizeAsin_invalid_returns_null(string? input) =>
        BookIdentityNormalizer.NormalizeAsin(input).Should().BeNull();

    // --- Title / author ---

    [Theory]
    [InlineData("  The  Truth   and Method ", "THE TRUTH AND METHOD")]
    [InlineData("Truth\tand\nMethod", "TRUTH AND METHOD")]
    [InlineData("fictions", "FICTIONS")]
    [InlineData("Nicomachean Ethics", "NICOMACHEAN ETHICS")]
    public void NormalizeTitle_collapses_whitespace_and_case_folds(string input, string expected) =>
        BookIdentityNormalizer.NormalizeTitle(input).Should().Be(expected);

    [Fact]
    public void NormalizeTitle_unicode_normalizes_and_preserves_subtitles()
    {
        // Full-width space collapses; subtitle TEXT is preserved while
        // punctuation spacing normalizes (frozen contract): "Title : Subtitle"
        // and "Title: Subtitle" share one identity.
        BookIdentityNormalizer.NormalizeTitle("War\u3000and Peace : A Novel").Should().Be("WAR AND PEACE A NOVEL");
        BookIdentityNormalizer.NormalizeTitle("War and Peace: A Novel").Should().Be("WAR AND PEACE A NOVEL");
        BookIdentityNormalizer.NormalizeTitle("War and Peace:A Novel").Should().Be("WAR AND PEACE A NOVEL");
    }

    [Theory]
    [InlineData("  Hans-Georg  Gadamer ", "HANS GEORG GADAMER")] // punctuation spacing
    [InlineData("Jean-Paul Sartre", "JEAN PAUL SARTRE")]
    [InlineData("José Ortega y Gasset", "JOSÉ ORTEGA Y GASSET")] // accents preserved
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    public void NormalizeAuthor_normalizes_and_preserves_accents_and_order(string? input, string expected) =>
        BookIdentityNormalizer.NormalizeAuthor(input).Should().Be(expected);
}
