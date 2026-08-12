using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 4B3 — target-reached notification outbox against real temp-file SQLite
// databases: enqueue scanning/deduping, atomic claiming under leases, and
// idempotent acknowledgement. The scanner is server-authoritative: elapsed =
// persisted AccumulatedSeconds + max(0, now - LastStartedAt), and only Active
// sessions accrue.
public sealed class ReadingNotificationOutboxTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private static readonly DateTime T0 = new(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc);

    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingNotificationOutboxTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    // --- enqueue scanning ---------------------------------------------------

    [Fact]
    public async Task Session_below_target_enqueues_nothing()
    {
        var h = Harness();
        await SeedOpenSession(h, accumulatedSeconds: 100, plannedTargetMinutes: 10,
            lastStartedAt: T0.AddSeconds(-100)); // elapsed 200 < 600

        var enqueued = await h.Outbox.EnqueueTargetReachedAsync();

        enqueued.Should().Be(0);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingNotifications.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Session_at_exact_threshold_enqueues_one_row_with_faithful_payload()
    {
        var h = Harness();
        var sessionId = await SeedOpenSession(h, ReadingMode.Deep, accumulatedSeconds: 500,
            plannedTargetMinutes: 10, lastStartedAt: T0.AddSeconds(-100)); // elapsed 600 == 600

        var enqueued = await h.Outbox.EnqueueTargetReachedAsync();

        enqueued.Should().Be(1);
        await using var db = h.Factory.CreateDbContext();
        var row = await db.ReadingNotifications.SingleAsync();
        row.Kind.Should().Be(ReadingNotificationOutbox.TargetReachedKind);
        row.DedupeKey.Should().Be($"target-reached:{sessionId:D}");
        row.AckedAt.Should().BeNull();
        row.LeaseUntil.Should().BeNull();
        row.CreatedAt.Should().Be(T0);

        // Deterministic camelCase JSON in declaration order; round-trips to
        // the same payload.
        var expectedJson =
            $"{{\"notificationId\":\"{row.Id:D}\",\"sessionId\":\"{sessionId:D}\"," +
            $"\"bookId\":\"{BookId(h, sessionId):D}\",\"mode\":1,\"plannedTargetMinutes\":10," +
            "\"effectiveElapsedSeconds\":600," +
            "\"message\":\"Reading target reached: 10 minutes elapsed (planned 10 minutes).\"}";
        row.PayloadJson.Should().Be(expectedJson);

        var payload = JsonSerializer.Deserialize<TargetReachedNotificationPayload>(
            row.PayloadJson, JsonOptions);
        payload.Should().Be(TargetReachedNotificationPayload.Create(
            row.Id, sessionId, BookId(h, sessionId), ReadingMode.Deep, 10, 600));
    }

    [Fact]
    public async Task Effective_elapsed_survives_service_recreation()
    {
        var path = _fixture.CreateDatabasePath();
        var clock = new MutableReadingClock(T0);
        var first = Harness(path, clock);
        await SeedOpenSession(first, accumulatedSeconds: 500, plannedTargetMinutes: 10,
            lastStartedAt: T0.AddSeconds(-50)); // elapsed 550 < 600
        (await first.Outbox.EnqueueTargetReachedAsync()).Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(60));
        var restarted = Harness(path, clock);
        var enqueued = await restarted.Outbox.EnqueueTargetReachedAsync();

        // Wall time since LastStartedAt is recomputed from persisted state, so
        // the restarted instance sees elapsed 610 >= 600.
        enqueued.Should().Be(1);
        await using var db = restarted.Factory.CreateDbContext();
        (await db.ReadingNotifications.CountAsync()).Should().Be(1);
    }

    [Theory]
    [InlineData(ReadingSessionStatus.Planned)]
    [InlineData(ReadingSessionStatus.Paused)]
    [InlineData(ReadingSessionStatus.AwaitingFeedback)]
    public async Task Non_accruing_open_statuses_never_enqueue(ReadingSessionStatus status)
    {
        var h = Harness();
        // Would be far over target if wall time accrued (elapsed 1500).
        await SeedOpenSession(h, accumulatedSeconds: 500, plannedTargetMinutes: 10,
            lastStartedAt: T0.AddSeconds(-1000), status: status);

        var enqueued = await h.Outbox.EnqueueTargetReachedAsync();

        enqueued.Should().Be(0);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingNotifications.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Repeated_and_restarted_enqueue_creates_exactly_one_row()
    {
        var h = Harness();
        await SeedOpenSession(h, accumulatedSeconds: 700, plannedTargetMinutes: 10,
            lastStartedAt: T0);

        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(0);
        var restarted = Harness(null, h.Clock);
        (await restarted.Outbox.EnqueueTargetReachedAsync()).Should().Be(0);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingNotifications.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Concurrent_enqueue_creates_exactly_one_row()
    {
        var h = Harness();
        await SeedOpenSession(h, accumulatedSeconds: 700, plannedTargetMinutes: 10,
            lastStartedAt: T0);

        var results = await Task.WhenAll(
            h.Outbox.EnqueueTargetReachedAsync(),
            h.Outbox.EnqueueTargetReachedAsync());

        results.Should().ContainSingle(r => r == 1);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingNotifications.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Enqueue_does_not_mutate_session_programme_or_state_version()
    {
        var h = Harness();
        await using (var db = h.Factory.CreateDbContext())
        {
            db.ReadingProgrammes.Add(new ReadingProgramme { CreatedAt = T0, UpdatedAt = T0 });
            await db.SaveChangesAsync();
        }
        var sessionId = await SeedOpenSession(h, accumulatedSeconds: 700, plannedTargetMinutes: 10,
            lastStartedAt: T0);

        await h.Outbox.EnqueueTargetReachedAsync();

        await using var db2 = h.Factory.CreateDbContext();
        var session = await db2.ReadingSessions.SingleAsync(s => s.Id == sessionId);
        session.Status.Should().Be(ReadingSessionStatus.Active);
        session.OpenSlot.Should().Be(ReadingSession.OpenSentinel);
        session.AccumulatedSeconds.Should().Be(700);
        session.MeasuredSeconds.Should().Be(0);
        session.NoticeSent.Should().BeFalse();
        session.UpdatedAt.Should().Be(T0.AddHours(-1)); // untouched by the scanner

        var programme = await db2.ReadingProgrammes.SingleAsync();
        programme.StateVersion.Should().Be("0");
        programme.UpdatedAt.Should().Be(T0);
        (await db2.ReadingNotifications.CountAsync()).Should().Be(1);
    }

    // --- claiming -----------------------------------------------------------

    [Fact]
    public async Task Claim_returns_oldest_rows_up_to_max_count_in_created_order()
    {
        var h = Harness();
        // Only one session may be open at a time; each is opened, scanned and
        // closed in turn, so rows get distinct CreatedAt instants.
        var s1 = await SeedOpenSession(h, accumulatedSeconds: 600, plannedTargetMinutes: 10,
            lastStartedAt: T0); // due at T0
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);
        await CloseSession(h, s1);

        h.Clock.Advance(TimeSpan.FromSeconds(60));
        var s2 = await SeedOpenSession(h, accumulatedSeconds: 300, plannedTargetMinutes: 10,
            lastStartedAt: T0.AddSeconds(-240)); // due at T0+60
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);
        await CloseSession(h, s2);

        h.Clock.Advance(TimeSpan.FromSeconds(60));
        var s3 = await SeedOpenSession(h, accumulatedSeconds: 240, plannedTargetMinutes: 10,
            lastStartedAt: T0.AddSeconds(-240)); // due at T0+120
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);
        await CloseSession(h, s3);

        var claimed = await h.Outbox.ClaimDueAsync(2, TimeSpan.FromMinutes(1));

        claimed.Should().HaveCount(2);
        claimed.Select(c => c.Payload.SessionId).Should().Equal(s1, s2); // oldest first
        claimed.Should().OnlyContain(c => c.Payload.SessionId != s3);
        claimed.Should().OnlyContain(c => c.LeaseUntil == T0.AddSeconds(120).AddMinutes(1));
        // The claimed row id is the notification row id embedded in the payload.
        foreach (var item in claimed)
            item.Payload.NotificationId.Should().Be(item.NotificationId);
        claimed.Select(c => c.Payload.NotificationId).Should().OnlyHaveUniqueItems();

        // The third row remains due and claimable.
        var rest = await h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(1));
        rest.Should().ContainSingle(c => c.Payload.SessionId == s3);
    }

    [Fact]
    public async Task Concurrent_claims_are_disjoint_and_cover_all_due_rows()
    {
        var h = Harness();
        for (var i = 0; i < 4; i++)
        {
            var sessionId = await SeedOpenSession(h, accumulatedSeconds: 700,
                plannedTargetMinutes: 10, lastStartedAt: T0);
            (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);
            await CloseSession(h, sessionId);
        }

        var results = await Task.WhenAll(
            h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(5)),
            h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(5)));
        var a = results[0];
        var b = results[1];

        var idsA = a.Select(c => c.NotificationId).ToHashSet();
        var idsB = b.Select(c => c.NotificationId).ToHashSet();
        idsA.Should().HaveCount(a.Count);
        idsB.Should().HaveCount(b.Count);
        idsA.Intersect(idsB).Should().BeEmpty();
        idsA.Union(idsB).Should().HaveCount(4);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingNotifications.CountAsync(n => n.LeaseUntil != null)).Should().Be(4);
    }

    [Fact]
    public async Task Claim_respects_lease_and_expiry_redelivers()
    {
        var h = Harness();
        await SeedOpenSession(h, accumulatedSeconds: 700, plannedTargetMinutes: 10,
            lastStartedAt: T0);
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);

        var first = await h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(1));
        first.Should().ContainSingle();
        var notificationId = first[0].NotificationId;

        // Unexpired lease hides the row.
        h.Clock.Advance(TimeSpan.FromSeconds(30));
        (await h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(1))).Should().BeEmpty();

        // Expired lease redelivers the same row with a fresh lease.
        h.Clock.Advance(TimeSpan.FromSeconds(31));
        var redelivered = await h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(1));
        var item = redelivered.Should().ContainSingle().Subject;
        item.NotificationId.Should().Be(notificationId);
        item.LeaseUntil.Should().Be(T0.AddSeconds(61).AddMinutes(1));
    }

    [Fact]
    public async Task Claim_validates_max_count_and_lease_bounds()
    {
        var h = Harness();

        var maxCountZero = async () => await h.Outbox.ClaimDueAsync(0, TimeSpan.FromMinutes(1));
        await maxCountZero.Should().ThrowAsync<ArgumentOutOfRangeException>();

        var maxCountNegative = async () => await h.Outbox.ClaimDueAsync(-1, TimeSpan.FromMinutes(1));
        await maxCountNegative.Should().ThrowAsync<ArgumentOutOfRangeException>();

        var zeroLease = async () => await h.Outbox.ClaimDueAsync(1, TimeSpan.Zero);
        await zeroLease.Should().ThrowAsync<ArgumentOutOfRangeException>();

        var negativeLease = async () => await h.Outbox.ClaimDueAsync(1, TimeSpan.FromMinutes(-1));
        await negativeLease.Should().ThrowAsync<ArgumentOutOfRangeException>();
    }

    // --- acknowledgement ----------------------------------------------------

    [Fact]
    public async Task Acknowledge_is_idempotent_clears_lease_and_acked_rows_are_never_claimable()
    {
        var h = Harness();
        await SeedOpenSession(h, accumulatedSeconds: 700, plannedTargetMinutes: 10,
            lastStartedAt: T0);
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);
        var claimed = await h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(5));
        var id = claimed.Should().ContainSingle().Subject.NotificationId;

        (await h.Outbox.AcknowledgeAsync(id)).Should().BeTrue();
        (await h.Outbox.AcknowledgeAsync(id)).Should().BeTrue(); // idempotent
        (await h.Outbox.AcknowledgeAsync(Guid.NewGuid())).Should().BeFalse(); // unknown

        await using var db = h.Factory.CreateDbContext();
        var row = await db.ReadingNotifications.SingleAsync();
        row.AckedAt.Should().Be(T0);
        row.LeaseUntil.Should().BeNull();

        // Acknowledged rows are never claimable, even after lease expiry.
        h.Clock.Advance(TimeSpan.FromMinutes(10));
        (await h.Outbox.ClaimDueAsync(10, TimeSpan.FromMinutes(5))).Should().BeEmpty();
    }

    [Fact]
    public async Task Unacknowledged_row_with_expired_lease_is_redelivered_then_ack_ends_delivery()
    {
        var h = Harness();
        await SeedOpenSession(h, accumulatedSeconds: 700, plannedTargetMinutes: 10,
            lastStartedAt: T0);
        (await h.Outbox.EnqueueTargetReachedAsync()).Should().Be(1);

        var first = await h.Outbox.ClaimDueAsync(10, TimeSpan.FromSeconds(10));
        var id = first.Should().ContainSingle().Subject.NotificationId;
        h.Clock.Advance(TimeSpan.FromSeconds(11));

        var second = await h.Outbox.ClaimDueAsync(10, TimeSpan.FromSeconds(10));
        second.Should().ContainSingle(c => c.NotificationId == id);
        await h.Outbox.AcknowledgeAsync(id);

        h.Clock.Advance(TimeSpan.FromMinutes(1));
        (await h.Outbox.ClaimDueAsync(10, TimeSpan.FromSeconds(10))).Should().BeEmpty();
    }

    // --- helpers ------------------------------------------------------------

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static Guid BookId(HarnessContext h, Guid sessionId)
    {
        using var db = h.Factory.CreateDbContext();
        return db.ReadingSessions.AsNoTracking().Single(s => s.Id == sessionId).BookId;
    }

    private HarnessContext Harness(string? databasePath = null, MutableReadingClock? clock = null)
    {
        var path = databasePath ?? _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        clock ??= new MutableReadingClock(T0);
        return new HarnessContext(factory, clock, new ReadingNotificationOutbox(factory, clock));
    }

    private async Task<Guid> SeedOpenSession(
        HarnessContext h,
        ReadingMode mode = ReadingMode.Deep,
        int accumulatedSeconds = 0,
        int plannedTargetMinutes = 10,
        DateTime? lastStartedAt = null,
        ReadingSessionStatus status = ReadingSessionStatus.Active)
    {
        await using var db = h.Factory.CreateDbContext();
        var book = new PhysicalBookModel { Title = $"Book-{Guid.NewGuid():N}" };
        var assignment = new ReadingBookAssignment
        {
            Book = book,
            BookId = book.Id,
            Mode = mode,
            QueueOrder = 0,
            Status = ReadingAssignmentStatus.Active,
            CreatedAt = T0,
        };
        var session = new ReadingSession
        {
            BookAssignment = assignment,
            BookAssignmentId = assignment.Id,
            Book = book,
            BookId = book.Id,
            Mode = mode,
            Status = status,
            OpenSlot = ReadingSession.OpenSentinel,
            TargetMinutes = plannedTargetMinutes,
            PlannedTargetMinutes = plannedTargetMinutes,
            AccumulatedSeconds = accumulatedSeconds,
            PlannedAt = T0.AddHours(-1),
            StartedAt = lastStartedAt ?? T0,
            LastStartedAt = lastStartedAt,
            CreatedAt = T0.AddHours(-1),
            UpdatedAt = T0.AddHours(-1),
        };
        db.Books.Add(book);
        db.ReadingBookAssignments.Add(assignment);
        db.ReadingSessions.Add(session);
        await db.SaveChangesAsync();
        return session.Id;
    }

    private static async Task CloseSession(HarnessContext h, Guid sessionId)
    {
        await using var db = h.Factory.CreateDbContext();
        var session = await db.ReadingSessions.SingleAsync(s => s.Id == sessionId);
        session.Status = ReadingSessionStatus.Completed;
        session.OpenSlot = null;
        await db.SaveChangesAsync();
    }

    private sealed record HarnessContext(
        TestContextFactory Factory,
        MutableReadingClock Clock,
        ReadingNotificationOutbox Outbox);

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class MutableReadingClock(DateTime utcNow) : IReadingClock
    {
        public DateTime UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan amount) => UtcNow = UtcNow.Add(amount);
    }
}
