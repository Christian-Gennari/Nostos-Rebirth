using FluentAssertions;
using Nostos.Backend.Configuration;
using Xunit;

namespace Nostos.Backend.Tests.Configuration;

public sealed class LibraryReceiptRetentionOptionsTests
{
    [Fact]
    public void Defaults_match_the_retention_contract()
    {
        var options = new LibraryReceiptRetentionOptions();

        options.RetentionDays.Should().Be(90);
        options.MaximumReceipts.Should().Be(10_000);
        options.CleanupIntervalHours.Should().Be(24);
    }

    [Fact]
    public void Normalize_keeps_safe_values_unchanged()
    {
        var options = new LibraryReceiptRetentionOptions { RetentionDays = 90, MaximumReceipts = 10_000, CleanupIntervalHours = 24 };

        var result = LibraryReceiptRetentionOptions.Normalize(options);

        result.Should().BeSameAs(options);
        options.RetentionDays.Should().Be(90);
        options.MaximumReceipts.Should().Be(10_000);
        options.CleanupIntervalHours.Should().Be(24);
    }

    [Fact]
    public void Normalize_clamps_unsafe_values_into_safe_ranges()
    {
        var options = new LibraryReceiptRetentionOptions
        {
            RetentionDays = -5,
            MaximumReceipts = 1,
            CleanupIntervalHours = 0,
        };

        LibraryReceiptRetentionOptions.Normalize(options);

        options.RetentionDays.Should().Be(LibraryReceiptRetentionOptions.MinRetentionDays);
        options.MaximumReceipts.Should().Be(LibraryReceiptRetentionOptions.MinMaximumReceipts);
        options.CleanupIntervalHours.Should().Be(LibraryReceiptRetentionOptions.MinCleanupIntervalHours);
    }

    [Fact]
    public void Normalize_clamps_absurd_upper_values()
    {
        var options = new LibraryReceiptRetentionOptions
        {
            RetentionDays = int.MaxValue,
            MaximumReceipts = int.MaxValue,
            CleanupIntervalHours = 100_000,
        };

        LibraryReceiptRetentionOptions.Normalize(options);

        options.RetentionDays.Should().Be(LibraryReceiptRetentionOptions.MaxRetentionDays);
        options.MaximumReceipts.Should().Be(LibraryReceiptRetentionOptions.MaxMaximumReceipts);
        options.CleanupIntervalHours.Should().Be(LibraryReceiptRetentionOptions.MaxCleanupIntervalHours);
    }
}
