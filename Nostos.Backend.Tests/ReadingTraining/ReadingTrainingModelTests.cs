using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Tests.ReadingTraining;

public class ReadingTrainingModelTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingTrainingModelTests(ReadingTrainingSqliteFixture fixture)
    {
        _fixture = fixture;
    }

    private static PhysicalBookModel NewBook(string title = "Test Book") => new()
    {
        Title = title,
        Author = "Author",
    };

    private static ReadingBookAssignment NewAssignment(Guid bookId, ReadingMode mode, int queueOrder = 0) => new()
    {
        BookId = bookId,
        Mode = mode,
        QueueOrder = queueOrder,
        Status = ReadingAssignmentStatus.Active,
    };

    private static ReadingSession NewOpenSession(Guid assignmentId, Guid bookId, ReadingMode mode) => new()
    {
        BookAssignmentId = assignmentId,
        BookId = bookId,
        Mode = mode,
        Status = ReadingSessionStatus.Active,
        OpenSlot = ReadingSession.OpenSentinel,
        TargetMinutes = 30,
        PlannedAt = new DateTime(2026, 8, 9, 12, 0, 0, DateTimeKind.Utc),
    };

    private static Func<Task> Saving(NostosDbContext db) =>
        async () => await db.SaveChangesAsync();

    public static TheoryData<ReadingSessionStatus> OpenStatuses => new()
    {
        ReadingSessionStatus.Planned,
        ReadingSessionStatus.Active,
        ReadingSessionStatus.Paused,
        ReadingSessionStatus.AwaitingFeedback,
    };

    public static TheoryData<ReadingSessionStatus> ClosedStatuses => new()
    {
        ReadingSessionStatus.Idle,
        ReadingSessionStatus.Completed,
        ReadingSessionStatus.Cancelled,
    };

    [Fact]
    public async Task Singleton_programme_row_is_enforced()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingProgrammes.Add(new ReadingProgramme());
        await db.SaveChangesAsync();

        db.ReadingProgrammes.Add(new ReadingProgramme { Id = Guid.NewGuid() });
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Second_globally_open_session_is_rejected_by_unique_open_slot()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        db.ReadingSessions.Add(NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep));
        await db.SaveChangesAsync();

        db.ReadingSessions.Add(NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep));
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Closed_sessions_may_coexist_in_database()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var first = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        first.OpenSlot = null;
        first.Status = ReadingSessionStatus.Completed;
        db.ReadingSessions.Add(first);

        var second = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        second.OpenSlot = null;
        second.Status = ReadingSessionStatus.Cancelled;
        db.ReadingSessions.Add(second);

        await db.SaveChangesAsync();
        (await db.ReadingSessions.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Second_default_assignment_for_same_mode_is_rejected()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var first = NewAssignment(book.Id, ReadingMode.Deep);
        first.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep);
        db.ReadingBookAssignments.Add(first);
        await db.SaveChangesAsync();

        var second = NewAssignment(book.Id, ReadingMode.Deep);
        second.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep);
        db.ReadingBookAssignments.Add(second);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Default_assignments_for_different_modes_may_coexist()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var endurance = NewAssignment(book.Id, ReadingMode.Endurance);
        endurance.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Endurance);
        db.ReadingBookAssignments.Add(endurance);

        var deep = NewAssignment(book.Id, ReadingMode.Deep);
        deep.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep);
        db.ReadingBookAssignments.Add(deep);

        await db.SaveChangesAsync();
        (await db.ReadingBookAssignments.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Multiple_non_default_assignments_for_same_mode_are_allowed()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        db.ReadingBookAssignments.Add(NewAssignment(book.Id, ReadingMode.Deep, queueOrder: 0));
        db.ReadingBookAssignments.Add(NewAssignment(book.Id, ReadingMode.Deep, queueOrder: 1));
        await db.SaveChangesAsync();

        (await db.ReadingBookAssignments.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Command_receipt_is_unique_on_client_id_and_idempotency_key()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
        {
            ClientId = "telegram-7",
            IdempotencyKey = "k-1",
            CommandKind = "StartSession",
            ResponseJson = "{}",
        });
        await db.SaveChangesAsync();

        db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
        {
            ClientId = "telegram-7",
            IdempotencyKey = "k-1",
            CommandKind = "StartSession",
            ResponseJson = "{}",
        });
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Command_receipt_allows_distinct_keys_for_same_client()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
        {
            ClientId = "telegram-7",
            IdempotencyKey = "k-1",
            CommandKind = "StartSession",
            ResponseJson = "{}",
        });
        db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
        {
            ClientId = "telegram-7",
            IdempotencyKey = "k-2",
            CommandKind = "PauseSession",
            ResponseJson = "{}",
        });
        await db.SaveChangesAsync();

        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Capture_external_id_is_unique_when_present()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        db.ReadingCaptures.Add(new ReadingCapture
        {
            Text = "verbatim",
            BookId = book.Id,
            ExternalId = "tg-msg-99",
        });
        await db.SaveChangesAsync();

        db.ReadingCaptures.Add(new ReadingCapture
        {
            Text = "duplicate",
            BookId = book.Id,
            ExternalId = "tg-msg-99",
        });
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Captures_without_external_id_may_be_stored_multiple_times()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        db.ReadingCaptures.Add(new ReadingCapture { Text = "one", BookId = book.Id });
        db.ReadingCaptures.Add(new ReadingCapture { Text = "two", BookId = book.Id });
        await db.SaveChangesAsync();

        (await db.ReadingCaptures.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Deleting_a_book_with_an_assignment_is_rejected_not_cascaded()
    {
        var databasePath = _fixture.CreateDatabasePath();

        Guid bookId;
        await using (var seed = _fixture.CreateContext(databasePath))
        {
            var book = NewBook();
            seed.Books.Add(book);
            await seed.SaveChangesAsync();
            bookId = book.Id;

            seed.ReadingBookAssignments.Add(NewAssignment(book.Id, ReadingMode.Endurance));
            await seed.SaveChangesAsync();
        }

        // Delete through a fresh context so EF change tracking does not mask the
        // database-level FK rejection.
        await using var db = _fixture.CreateContext(databasePath);
        var tracked = db.Books.Single(b => b.Id == bookId);
        db.Books.Remove(tracked);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Weekly_review_is_unique_per_iso_week_and_mode()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingWeeklyReviews.Add(new ReadingWeeklyReview
        {
            WeekKey = "2026-W32",
            Mode = ReadingMode.Deep,
            DecisionKind = "Hold",
        });
        await db.SaveChangesAsync();

        db.ReadingWeeklyReviews.Add(new ReadingWeeklyReview
        {
            WeekKey = "2026-W32",
            Mode = ReadingMode.Deep,
            DecisionKind = "Hold",
        });
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Weekly_reviews_for_different_modes_in_same_week_may_coexist()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingWeeklyReviews.Add(new ReadingWeeklyReview
        {
            WeekKey = "2026-W32",
            Mode = ReadingMode.Deep,
            DecisionKind = "Hold",
        });
        db.ReadingWeeklyReviews.Add(new ReadingWeeklyReview
        {
            WeekKey = "2026-W32",
            Mode = ReadingMode.Endurance,
            DecisionKind = "Promote",
        });
        await db.SaveChangesAsync();

        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Session_state_persists_across_separate_contexts()
    {
        var databasePath = _fixture.CreateDatabasePath();

        Guid sessionId;
        await using (var db = _fixture.CreateContext(databasePath))
        {
            var book = NewBook();
            db.Books.Add(book);
            await db.SaveChangesAsync();

            var assignment = NewAssignment(book.Id, ReadingMode.Deep);
            db.ReadingBookAssignments.Add(assignment);
            await db.SaveChangesAsync();

            var session = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
            session.AccumulatedSeconds = 600;
            session.MeasuredSeconds = 900;
            db.ReadingSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        await using (var db = _fixture.CreateContext(databasePath))
        {
            var loaded = await db.ReadingSessions.SingleAsync(s => s.Id == sessionId);
            loaded.Status.Should().Be(ReadingSessionStatus.Active);
            loaded.AccumulatedSeconds.Should().Be(600);
            loaded.MeasuredSeconds.Should().Be(900);
            loaded.PlannedAt.Kind.Should().Be(DateTimeKind.Utc);
        }
    }

    [Theory]
    [MemberData(nameof(OpenStatuses))]
    public async Task Open_session_statuses_require_the_open_slot_sentinel(ReadingSessionStatus status)
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var session = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        session.Status = status;
        session.OpenSlot = null; // open state without the sentinel
        db.ReadingSessions.Add(session);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Theory]
    [MemberData(nameof(ClosedStatuses))]
    public async Task Closed_session_statuses_require_a_null_open_slot(ReadingSessionStatus status)
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var session = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        session.Status = status;
        // closed state still holding the open-slot sentinel
        db.ReadingSessions.Add(session);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Wrong_open_slot_sentinel_is_rejected()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var session = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        session.OpenSlot = 42; // open state with a wrong sentinel value
        db.ReadingSessions.Add(session);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Planned_session_occupies_the_unique_global_open_slot()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var first = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        first.Status = ReadingSessionStatus.Planned;
        db.ReadingSessions.Add(first);
        await db.SaveChangesAsync();

        var second = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        second.Status = ReadingSessionStatus.Planned;
        db.ReadingSessions.Add(second);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Assignment_default_slot_must_equal_the_numeric_mode()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        assignment.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Recovery); // mismatched mode
        db.ReadingBookAssignments.Add(assignment);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Assignment_default_slot_requires_active_status()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        assignment.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep);
        assignment.Status = ReadingAssignmentStatus.Queued; // default slot on an inactive assignment
        db.ReadingBookAssignments.Add(assignment);
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Programme_singleton_sentinel_is_enforced()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingProgrammes.Add(new ReadingProgramme { SingletonSlot = 2 });
        await Saving(db).Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Close_then_reopen_works_across_separate_saves()
    {
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var session = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        db.ReadingSessions.Add(session);
        await db.SaveChangesAsync();

        // Close: release the global open slot in its own save.
        session.Status = ReadingSessionStatus.Completed;
        session.OpenSlot = null;
        await db.SaveChangesAsync();

        // Reopen: a new session may take the slot in a later save.
        var replacement = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        replacement.Status = ReadingSessionStatus.Planned;
        db.ReadingSessions.Add(replacement);
        await db.SaveChangesAsync();

        (await db.ReadingSessions.CountAsync()).Should().Be(2);
        (await db.ReadingSessions.CountAsync(s => s.OpenSlot != null)).Should().Be(1);
    }

    [Fact]
    public async Task Closing_and_reopening_in_one_save_is_allowed_by_ef_command_ordering()
    {
        // EF Core 10 applies the closing UPDATE before the reopening INSERT
        // within a single SaveChanges, so the replacement session never sees
        // an occupied slot. Services may still close and reopen in separate
        // saves for clarity; both orders are supported.
        await using var db = _fixture.CreateContext();
        var book = NewBook();
        db.Books.Add(book);
        await db.SaveChangesAsync();

        var assignment = NewAssignment(book.Id, ReadingMode.Deep);
        db.ReadingBookAssignments.Add(assignment);
        await db.SaveChangesAsync();

        var session = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        db.ReadingSessions.Add(session);
        await db.SaveChangesAsync();

        session.Status = ReadingSessionStatus.Completed;
        session.OpenSlot = null;
        var replacement = NewOpenSession(assignment.Id, book.Id, ReadingMode.Deep);
        db.ReadingSessions.Add(replacement);
        await db.SaveChangesAsync();

        (await db.ReadingSessions.CountAsync()).Should().Be(2);
        (await db.ReadingSessions.CountAsync(s => s.OpenSlot != null)).Should().Be(1);
    }

    [Fact]
    public async Task Command_receipt_allows_same_idempotency_key_for_different_clients()
    {
        await using var db = _fixture.CreateContext();
        db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
        {
            ClientId = "telegram-7",
            IdempotencyKey = "k-1",
            CommandKind = "StartSession",
            ResponseJson = "{}",
        });
        db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
        {
            ClientId = "telegram-8",
            IdempotencyKey = "k-1",
            CommandKind = "StartSession",
            ResponseJson = "{}",
        });
        await db.SaveChangesAsync();

        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(2);
    }
}
