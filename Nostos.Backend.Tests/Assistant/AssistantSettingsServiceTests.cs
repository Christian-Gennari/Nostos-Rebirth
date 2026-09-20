using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Assistant;

/// <summary>
/// Coverage for the stored assistant settings (issue #262 §7): the capture
/// post-processing mode the owner chooses once. The database is a real temporary
/// SQLite file, so the "no row" and "stored verbatim" states are exercised for
/// real rather than assumed.
/// </summary>
public sealed class AssistantSettingsServiceTests : IDisposable
{
    private readonly SqliteTestFixture _fixture = new();

    public void Dispose() => _fixture.Dispose();

    [Fact]
    public async Task Get_defaults_to_verbatim_with_no_row()
    {
        var service = CreateService(out _);

        (await service.GetAsync()).CaptureProcessingMode.Should().Be(ThoughtProcessingModes.Verbatim);
        (await service.GetCaptureProcessingModeAsync()).Should().Be(ThoughtProcessingModes.Verbatim);
    }

    [Fact]
    public async Task Update_stores_the_mode_and_the_response_matches_get()
    {
        var service = CreateService(out _);

        var outcome = await service.UpdateAsync(new AssistantSettingsUpdateRequest("light_polish"));

        outcome.Success.Should().BeTrue();
        outcome.ErrorCode.Should().BeNull();
        outcome.Settings!.CaptureProcessingMode.Should().Be("light_polish");

        // The response is the re-read effective value, the same shape as GET.
        var get = await service.GetAsync();
        get.CaptureProcessingMode.Should().Be("light_polish");
        (await service.GetCaptureProcessingModeAsync()).Should().Be("light_polish");
    }

    [Fact]
    public async Task Update_normalises_the_stored_mode()
    {
        var service = CreateService(out _);

        var outcome = await service.UpdateAsync(new AssistantSettingsUpdateRequest("LIGHT_POLISH"));

        outcome.Success.Should().BeTrue();
        outcome.Settings!.CaptureProcessingMode.Should().Be("light_polish");
    }

    [Fact]
    public async Task Update_rewrites_the_single_row_rather_than_inserting_a_second()
    {
        var service = CreateService(out var factory);

        await service.UpdateAsync(new AssistantSettingsUpdateRequest("light_polish"));
        await service.UpdateAsync(new AssistantSettingsUpdateRequest("clarify"));

        await using var db = await factory.CreateDbContextAsync();
        (await db.AssistantSettings.CountAsync()).Should().Be(1);
        (await db.AssistantSettings.AsNoTracking().SingleAsync()).CaptureProcessingMode.Should().Be("clarify");
    }

    [Theory]
    [InlineData("nonsense")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task An_unsupported_mode_is_refused_and_stores_nothing(string? mode)
    {
        var service = CreateService(out var factory);

        var outcome = await service.UpdateAsync(new AssistantSettingsUpdateRequest(mode));

        outcome.Success.Should().BeFalse();
        outcome.Settings.Should().BeNull();
        outcome.ErrorCode.Should().Be(AssistantErrorCodes.InvalidProcessingMode);

        // Nothing was stored: the effective value is still the default.
        (await service.GetAsync()).CaptureProcessingMode.Should().Be(ThoughtProcessingModes.Verbatim);

        await using var db = await factory.CreateDbContextAsync();
        (await db.AssistantSettings.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task A_refused_update_leaves_a_previously_stored_mode_untouched()
    {
        var service = CreateService(out _);

        await service.UpdateAsync(new AssistantSettingsUpdateRequest("light_polish"));

        var refused = await service.UpdateAsync(new AssistantSettingsUpdateRequest("nonsense"));

        refused.Success.Should().BeFalse();
        (await service.GetAsync()).CaptureProcessingMode.Should().Be("light_polish");
    }

    private AssistantSettingsService CreateService(out IDbContextFactory<NostosDbContext> factory)
    {
        var path = _fixture.CreateDatabasePath();
        using (var db = _fixture.CreateContext(path))
        {
            // EnsureCreated is idempotent; this guarantees the schema on the
            // temporary path the fixture owns (and cleans up).
        }

        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;

        var contextFactory = new TestDbContextFactory(options);
        factory = contextFactory;
        return new AssistantSettingsService(contextFactory);
    }

    private sealed class TestDbContextFactory(DbContextOptions<NostosDbContext> options)
        : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);

        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }
}
