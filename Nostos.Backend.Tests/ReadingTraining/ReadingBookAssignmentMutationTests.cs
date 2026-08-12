using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Mutation matrix for issue #29: change-book-mode and remove-from-queue.
// Exercises the full domain contract against a real temporary-file SQLite
// database (the unique DefaultSlot index is part of the contract, so the
// EF in-memory provider would be wrong). Seeding mirrors
// ReadingTrainingServiceTests: books and assignments are created through the
// service so queue-order and default-slot bookkeeping match production;
// sessions and status overrides are seeded directly because they are not
// part of the tested surface.
public sealed class ReadingBookAssignmentMutationTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingBookAssignmentMutationTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    // --- change mode: plain move -------------------------------------------

    [Fact]
    public async Task ChangeMode_PlainMove_PreservesIdentityAndOrder_ClearsOldDefault()
    {
        var h = Harness();
        await h.Init();
        var sourceBook = await h.AddBook("Candide");
        var otherEnduranceBook = await h.AddBook("Essays");
        var deepBook = await h.AddBook("Enneads");

        // source: Endurance default; a second Endurance assignment and an
        // unrelated Deep assignment (different book) fill the rest of the queue.
        var source = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", sourceBook, ReadingMode.Endurance, MakeDefault: true))).Data!;
        var otherEndurance = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", otherEnduranceBook, ReadingMode.Endurance))).Data!;
        var deepOther = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-3", deepBook, ReadingMode.Deep))).Data!;
        var versionBefore = await h.Version();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-1", source.Id, ReadingMode.Deep));

        var data = (ReadingChangeBookModeDataDto)result.Data!;
        result.Reply.Should().Be("Candide moved to Deep.");
        result.Duplicate.Should().BeFalse();
        data.AssignmentId.Should().Be(source.Id);
        data.BookId.Should().Be(sourceBook);
        data.PreviousMode.Should().Be(ReadingMode.Endurance);
        data.Mode.Should().Be(ReadingMode.Deep);
        data.QueueOrder.Should().Be(source.QueueOrder);
        data.DefaultSlot.Should().BeNull("the source does not inherit a default without a collider");
        data.CollisionAbsorbed.Should().BeFalse();
        data.AbsorbedAssignmentId.Should().BeNull();

        await using (var db = h.Factory.CreateDbContext())
        {
            var row = await db.ReadingBookAssignments.Include(x => x.Book).SingleAsync(x => x.Id == source.Id);
            row.Mode.Should().Be(ReadingMode.Deep);
            row.QueueOrder.Should().Be(source.QueueOrder);
            row.CreatedAt.Should().Be(source.CreatedAt);
            row.StartedAt.Should().Be(source.StartedAt);
            row.CompletedAt.Should().BeNull();
            row.DefaultSlot.Should().BeNull();
            // Old default cleared: no Endurance default remains anywhere.
            (await db.ReadingBookAssignments.CountAsync(x => x.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Endurance)))
                .Should().Be(0);
            // No Deep default appeared (there was no collider to inherit from).
            (await db.ReadingBookAssignments.CountAsync(x => x.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep)))
                .Should().Be(0);
            // Other assignments untouched.
            (await db.ReadingBookAssignments.SingleAsync(x => x.Id == deepOther.Id)).Mode.Should().Be(ReadingMode.Deep);
            (await db.ReadingBookAssignments.SingleAsync(x => x.Id == otherEndurance.Id))
                .Mode.Should().Be(ReadingMode.Endurance);
            // Exactly one session-free move: one row for the book's new mode.
            (await db.ReadingBookAssignments.CountAsync(x => x.BookId == sourceBook)).Should().Be(1);
        }
        result.StateVersion.Should().Be(NextVersion(versionBefore), "a successful move bumps the state version exactly once");
    }

    // --- change mode: absorb -------------------------------------------------

    // Reproduces the exact live topology from the expert plan: source
    // Endurance / default-null / order 2, collider Deep / default-Deep /
    // order 3. The absorb deletes the collider, keeps the source's identity
    // and queue order (gap left at 3), and inherits the Deep default.
    [Fact]
    public async Task ChangeMode_AbsorbLiveTopology_InheritsColliderDefault_LeavesGap()
    {
        var h = Harness();
        await h.Init();
        var essaysBook = await h.AddBook("Essays");
        var enneadsBook = await h.AddBook("Enneads");
        var candideBook = await h.AddBook("Candide");

        var essays = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", essaysBook, ReadingMode.Endurance))).Data!;                             // order 0
        var enneads = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", enneadsBook, ReadingMode.Deep))).Data!;                                 // order 1
        var source = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-3", candideBook, ReadingMode.Endurance))).Data!;                                     // order 2, default-null
        var collider = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-4", candideBook, ReadingMode.Deep, MakeDefault: true))).Data!;                       // order 3, default-Deep

        source.QueueOrder.Should().Be(2);
        source.IsDefault.Should().BeFalse();
        collider.QueueOrder.Should().Be(3);
        collider.IsDefault.Should().BeTrue();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-live", source.Id, ReadingMode.Deep));

        var data = (ReadingChangeBookModeDataDto)result.Data!;
        result.Reply.Should().Be("Candide moved to Deep. Duplicate queue entry removed.");
        data.Mode.Should().Be(ReadingMode.Deep);
        data.PreviousMode.Should().Be(ReadingMode.Endurance);
        data.QueueOrder.Should().Be(2, "the source keeps its queue position; nothing is renumbered");
        data.DefaultSlot.Should().Be("1", "the source inherits the absorbed collider's Deep default sentinel");
        data.CollisionAbsorbed.Should().BeTrue();
        data.AbsorbedAssignmentId.Should().Be(collider.Id);

        await using (var db = h.Factory.CreateDbContext())
        {
            var remaining = await db.ReadingBookAssignments.Include(x => x.Book)
                .OrderBy(x => x.QueueOrder).ToListAsync();
            remaining.Select(x => x.Id).Should().Equal(essays.Id, enneads.Id, source.Id)
                .And.NotContain(collider.Id, "the collider is deleted");
            remaining.Select(x => x.QueueOrder).Should().Equal(0, 1, 2); // source keeps order 2; gap left at 3
            var moved = remaining.Single(x => x.Id == source.Id);
            moved.Mode.Should().Be(ReadingMode.Deep);
            moved.DefaultSlot.Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep));
            moved.CreatedAt.Should().Be(source.CreatedAt);
            moved.StartedAt.Should().Be(source.StartedAt);
            (await db.ReadingBookAssignments.CountAsync(x => x.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep)))
                .Should().Be(1, "exactly one Deep default remains");
            (await db.ReadingBookAssignments.CountAsync(x => x.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Endurance)))
                .Should().Be(0);
        }
    }

    [Fact]
    public async Task ChangeMode_Absorb_ReleasesBothSentinelsBeforeClaiming()
    {
        var h = Harness();
        await h.Init();
        var essaysBook = await h.AddBook("Essays");
        var candideBook = await h.AddBook("Candide");

        // The source holds the Endurance sentinel and the collider holds the
        // Deep sentinel: the absorb must release both in phase 1 before the
        // source claims Deep in phase 2, or the unique DefaultSlot index
        // would reject the save.
        await h.Service.AddBookAssignmentAsync(new("ui", "add-1", essaysBook, ReadingMode.Endurance));
        var source = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", candideBook, ReadingMode.Endurance, MakeDefault: true))).Data!;
        var collider = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-3", candideBook, ReadingMode.Deep, MakeDefault: true))).Data!;
        source.IsDefault.Should().BeTrue();
        collider.IsDefault.Should().BeTrue();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-sentinels", source.Id, ReadingMode.Deep));

        result.Data.Should().BeOfType<ReadingChangeBookModeDataDto>().Which.DefaultSlot.Should().Be("1");
        await using var db = h.Factory.CreateDbContext();
        var rows = await db.ReadingBookAssignments.ToListAsync();
        rows.Should().ContainSingle(x => x.Id == source.Id);
        rows.Should().NotContain(x => x.Id == collider.Id);
        rows.Where(x => x.DefaultSlot != null).Should().ContainSingle()
            .Which.Id.Should().Be(source.Id, "the source is the only remaining default");
    }

    [Fact]
    public async Task ChangeMode_AbsorbWithoutColliderDefault_LeavesSourceNonDefault_UnrelatedDefaultUntouched()
    {
        var h = Harness();
        await h.Init();
        var enneadsBook = await h.AddBook("Enneads");
        var candideBook = await h.AddBook("Candide");

        // The Deep default belongs to a different book; the collider is a
        // plain Deep entry. After the absorb the source must NOT inherit the
        // default, and the unrelated default must stay put.
        var unrelatedDefault = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", enneadsBook, ReadingMode.Deep, MakeDefault: true))).Data!;
        var source = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", candideBook, ReadingMode.Endurance))).Data!;
        var collider = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-3", candideBook, ReadingMode.Deep))).Data!;

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-noinherit", source.Id, ReadingMode.Deep));

        var data = (ReadingChangeBookModeDataDto)result.Data!;
        data.CollisionAbsorbed.Should().BeTrue();
        data.AbsorbedAssignmentId.Should().Be(collider.Id);
        data.DefaultSlot.Should().BeNull("the absorbed collider was not the Deep default");

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.SingleAsync(x => x.Id == unrelatedDefault.Id)).DefaultSlot
            .Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep), "unrelated defaults are untouched");
        (await db.ReadingBookAssignments.SingleAsync(x => x.Id == source.Id)).DefaultSlot.Should().BeNull();
        (await db.ReadingBookAssignments.CountAsync(x => x.BookId == candideBook)).Should().Be(1);
    }

    // --- change mode: rejections ---------------------------------------------

    [Theory]
    [InlineData(ReadingSessionStatus.Planned)]
    [InlineData(ReadingSessionStatus.Completed)]
    [InlineData(ReadingSessionStatus.Cancelled)]
    public async Task ChangeMode_SourceWithAnySession_IsRejected_WithoutMutation(ReadingSessionStatus status)
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;
        await h.SeedSession(assignment.Id, status);
        var versionBefore = await h.Version();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-session", assignment.Id, ReadingMode.Deep));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("assignment_has_sessions");
        result.Reply.Should().Be("Candide has sessions and cannot be changed.");
        result.StateVersion.Should().Be(versionBefore, "rejections never bump the state version");
        await using var db = h.Factory.CreateDbContext();
        var row = await db.ReadingBookAssignments.SingleAsync(x => x.Id == assignment.Id);
        row.Mode.Should().Be(ReadingMode.Endurance);
        row.DefaultSlot.Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Endurance));
    }

    [Fact]
    public async Task ChangeMode_ColliderWithAnySession_IsRejected_LeavesBothUnchanged()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var source = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;
        var collider = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", book, ReadingMode.Deep, MakeDefault: true))).Data!;
        await h.SeedSession(collider.Id, ReadingSessionStatus.Planned);
        var versionBefore = await h.Version();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-collision", source.Id, ReadingMode.Deep));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("mode_collision_has_sessions");
        result.Reply.Should().Be("Candide already has a Deep assignment with sessions.");
        result.StateVersion.Should().Be(versionBefore);
        await using var db = h.Factory.CreateDbContext();
        var rows = await db.ReadingBookAssignments.ToListAsync();
        rows.Single(x => x.Id == source.Id).Mode.Should().Be(ReadingMode.Endurance);
        rows.Single(x => x.Id == source.Id).DefaultSlot.Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Endurance));
        rows.Single(x => x.Id == collider.Id).Mode.Should().Be(ReadingMode.Deep);
        rows.Single(x => x.Id == collider.Id).DefaultSlot.Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep));
    }

    [Fact]
    public async Task ChangeMode_SameMode_IsRejected()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;
        var versionBefore = await h.Version();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-same", assignment.Id, ReadingMode.Endurance));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("mode_unchanged");
        result.Reply.Should().Be("Candide is already in Endurance.");
        result.StateVersion.Should().Be(versionBefore);
    }

    [Theory]
    [InlineData(ReadingAssignmentStatus.Completed, "assignment_completed", "Candide is completed and cannot be changed.")]
    [InlineData(ReadingAssignmentStatus.Archived, "assignment_archived", "Candide is archived and cannot be changed.")]
    [InlineData(ReadingAssignmentStatus.Queued, "assignment_not_active", "Candide is not active and cannot be changed.")]
    public async Task ChangeMode_NonActiveSource_IsRejected(ReadingAssignmentStatus status, string code, string reply)
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;
        await h.SetStatus(assignment.Id, status);
        var versionBefore = await h.Version();

        var result = await h.Service.ChangeBookModeAsync(new(
            "ui", $"change-{status}", assignment.Id, ReadingMode.Deep));

        ((ReadingErrorDto)result.Data!).Code.Should().Be(code);
        result.Reply.Should().Be(reply);
        result.StateVersion.Should().Be(versionBefore);
        await using var db = h.Factory.CreateDbContext();
        var row = await db.ReadingBookAssignments.SingleAsync(x => x.Id == assignment.Id);
        row.Mode.Should().Be(ReadingMode.Endurance);
        row.Status.Should().Be(status);
    }

    [Fact]
    public async Task ChangeMode_MissingAssignment_And_InvalidMode_AreRejected()
    {
        var h = Harness();
        await h.Init();
        var versionBefore = await h.Version();

        var missing = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-missing", Guid.NewGuid(), ReadingMode.Deep));

        ((ReadingErrorDto)missing.Data!).Code.Should().Be("assignment_not_found");
        missing.Reply.Should().Be(ReadingReplyFormatter.AssignmentNotFound);
        missing.StateVersion.Should().Be(versionBefore);

        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance))).Data!;
        var versionAfterAdd = await h.Version();
        var invalid = await h.Service.ChangeBookModeAsync(new(
            "ui", "change-invalid-mode", assignment.Id, (ReadingMode)99));

        ((ReadingErrorDto)invalid.Data!).Code.Should().Be("invalid_mode");
        invalid.StateVersion.Should().Be(versionAfterAdd);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.SingleAsync(x => x.Id == assignment.Id)).Mode.Should().Be(ReadingMode.Endurance);
    }

    // --- change mode: exact-once ---------------------------------------------

    [Fact]
    public async Task ChangeMode_ExactOnce_ReplayReturnsOriginal_WithoutDoubleApply()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;
        var request = new ReadingChangeBookModeCommandRequest("ui", "change-once", assignment.Id, ReadingMode.Deep);

        var first = await h.Service.ChangeBookModeAsync(request);
        var replay = await h.Service.ChangeBookModeAsync(request);

        replay.Duplicate.Should().BeTrue();
        replay.Reply.Should().Be(first.Reply);
        replay.StateVersion.Should().Be(first.StateVersion, "the replay returns the original state version, not a new bump");
        ((ReadingChangeBookModeDataDto)replay.Data!).AbsorbedAssignmentId.Should().BeNull();

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.SingleAsync(x => x.Id == assignment.Id)).Mode.Should().Be(ReadingMode.Deep);
        (await db.ReadingBookAssignments.CountAsync(x => x.BookId == book)).Should().Be(1, "the replay never re-applies the move");
        (await db.ReadingCommandReceipts.CountAsync(x => x.ClientId == "ui" && x.IdempotencyKey == "change-once")).Should().Be(1);
    }

    [Fact]
    public async Task ChangeMode_SameKeyDifferentClient_IsIndependent()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;

        var ui = await h.Service.ChangeBookModeAsync(new("ui", "shared-key", assignment.Id, ReadingMode.Deep));
        var mcp = await h.Service.ChangeBookModeAsync(new("mcp", "shared-key", assignment.Id, ReadingMode.Endurance));

        ui.Duplicate.Should().BeFalse();
        mcp.Duplicate.Should().BeFalse("receipts are keyed by (client, key); another client is independent");
        ((ReadingChangeBookModeDataDto)mcp.Data!).PreviousMode.Should().Be(ReadingMode.Deep);
        ((ReadingChangeBookModeDataDto)mcp.Data!).Mode.Should().Be(ReadingMode.Endurance);
        mcp.StateVersion.Should().Be(NextVersion(ui.StateVersion));
    }

    [Fact]
    public async Task ChangeMode_RejectionReplay_IsDuplicate_WithoutBumping()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance))).Data!;
        var request = new ReadingChangeBookModeCommandRequest("ui", "reject-once", assignment.Id, ReadingMode.Endurance);

        var first = await h.Service.ChangeBookModeAsync(request);
        var replay = await h.Service.ChangeBookModeAsync(request);

        ((ReadingErrorDto)first.Data!).Code.Should().Be("mode_unchanged");
        replay.Duplicate.Should().BeTrue();
        replay.Reply.Should().Be(first.Reply);
        replay.StateVersion.Should().Be(first.StateVersion);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingCommandReceipts.CountAsync(x => x.ClientId == "ui" && x.IdempotencyKey == "reject-once")).Should().Be(1);
    }

    // --- remove from queue ----------------------------------------------------

    [Fact]
    public async Task Remove_ActiveNoSessions_DeletesRowAndClearsDefault_LeavesGap()
    {
        var h = Harness();
        await h.Init();
        var candideBook = await h.AddBook("Candide");
        var essaysBook = await h.AddBook("Essays");
        var recoveryBook = await h.AddBook("Meditations");

        await h.Service.AddBookAssignmentAsync(new("ui", "add-1", essaysBook, ReadingMode.Endurance));
        var removed = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", candideBook, ReadingMode.Endurance, MakeDefault: true))).Data!;
        await h.Service.AddBookAssignmentAsync(new("ui", "add-3", essaysBook, ReadingMode.Deep));
        var recoveryDefault = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-4", recoveryBook, ReadingMode.Recovery, MakeDefault: true))).Data!;
        var versionBefore = await h.Version();

        var result = await h.Service.RemoveBookAssignmentAsync(new(
            "ui", "remove-1", removed.Id));

        var data = (ReadingRemoveBookAssignmentDataDto)result.Data!;
        result.Reply.Should().Be("Candide removed from the queue.");
        result.Duplicate.Should().BeFalse();
        data.AssignmentId.Should().Be(removed.Id);
        data.BookId.Should().Be(candideBook);
        data.Mode.Should().Be(ReadingMode.Endurance);
        data.QueueOrder.Should().Be(removed.QueueOrder);
        result.StateVersion.Should().Be(NextVersion(versionBefore));

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.CountAsync(x => x.Id == removed.Id)).Should().Be(0, "the row is deleted");
        (await db.ReadingBookAssignments.CountAsync(x => x.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Endurance)))
            .Should().Be(0, "deleting the default clears the mode's default slot");
        var remaining = await db.ReadingBookAssignments.OrderBy(x => x.QueueOrder).ToListAsync();
        remaining.Select(x => x.QueueOrder).Should().Equal(0, 2, 3); // remaining orders preserved; the gap at 1 stays
        (await db.ReadingBookAssignments.SingleAsync(x => x.Id == recoveryDefault.Id)).DefaultSlot
            .Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Recovery), "other defaults are untouched");
    }

    [Theory]
    [InlineData(ReadingSessionStatus.Planned)]
    [InlineData(ReadingSessionStatus.Completed)]
    [InlineData(ReadingSessionStatus.Cancelled)]
    public async Task Remove_AssignmentWithAnySession_IsRejected(ReadingSessionStatus status)
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance, MakeDefault: true))).Data!;
        await h.SeedSession(assignment.Id, status);
        var versionBefore = await h.Version();

        var result = await h.Service.RemoveBookAssignmentAsync(new(
            "ui", $"remove-{status}", assignment.Id));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("assignment_has_sessions");
        result.Reply.Should().Be("Candide has sessions and cannot be removed.");
        result.StateVersion.Should().Be(versionBefore);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.CountAsync(x => x.Id == assignment.Id)).Should().Be(1, "the row survives the rejection");
    }

    [Theory]
    [InlineData(ReadingAssignmentStatus.Completed, "assignment_completed", "Candide is completed and cannot be changed.")]
    [InlineData(ReadingAssignmentStatus.Archived, "assignment_archived", "Candide is archived and cannot be changed.")]
    [InlineData(ReadingAssignmentStatus.Queued, "assignment_not_active", "Candide is not active and cannot be removed.")]
    public async Task Remove_NonActiveAssignment_IsRejected(ReadingAssignmentStatus status, string code, string reply)
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance))).Data!;
        await h.SetStatus(assignment.Id, status);

        var result = await h.Service.RemoveBookAssignmentAsync(new(
            "ui", $"remove-{status}", assignment.Id));

        ((ReadingErrorDto)result.Data!).Code.Should().Be(code);
        result.Reply.Should().Be(reply);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.CountAsync(x => x.Id == assignment.Id)).Should().Be(1);
    }

    [Fact]
    public async Task Remove_MissingAssignment_IsRejected()
    {
        var h = Harness();
        await h.Init();

        var result = await h.Service.RemoveBookAssignmentAsync(new(
            "ui", "remove-missing", Guid.NewGuid()));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("assignment_not_found");
        result.Reply.Should().Be(ReadingReplyFormatter.AssignmentNotFound);
    }

    [Fact]
    public async Task Remove_ExactOnce_ReplayReturnsOriginal_AndNeverDeletesAnotherAssignment()
    {
        var h = Harness();
        await h.Init();
        var candideBook = await h.AddBook("Candide");
        var essaysBook = await h.AddBook("Essays");
        var removed = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", candideBook, ReadingMode.Endurance, MakeDefault: true))).Data!;
        var survivor = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-2", essaysBook, ReadingMode.Deep, MakeDefault: true))).Data!;
        var request = new ReadingRemoveBookAssignmentCommandRequest("ui", "remove-once", removed.Id);

        var first = await h.Service.RemoveBookAssignmentAsync(request);
        var replay = await h.Service.RemoveBookAssignmentAsync(request);

        replay.Duplicate.Should().BeTrue();
        replay.Reply.Should().Be(first.Reply);
        replay.StateVersion.Should().Be(first.StateVersion);
        ((ReadingRemoveBookAssignmentDataDto)replay.Data!).AssignmentId.Should().Be(removed.Id);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingBookAssignments.CountAsync(x => x.Id == removed.Id)).Should().Be(0);
        (await db.ReadingBookAssignments.CountAsync(x => x.Id == survivor.Id)).Should().Be(1, "the replay deletes nothing else");
        (await db.ReadingBookAssignments.SingleAsync(x => x.Id == survivor.Id)).DefaultSlot
            .Should().Be(ReadingBookAssignment.DefaultSentinelFor(ReadingMode.Deep));
        (await db.ReadingCommandReceipts.CountAsync(x => x.ClientId == "ui" && x.IdempotencyKey == "remove-once")).Should().Be(1);
    }

    [Fact]
    public async Task Remove_SameKeyDifferentClient_IsIndependent()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var assignment = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(
            new("ui", "add-1", book, ReadingMode.Endurance))).Data!;

        var ui = await h.Service.RemoveBookAssignmentAsync(new("ui", "shared-key", assignment.Id));
        var mcp = await h.Service.RemoveBookAssignmentAsync(new("mcp", "shared-key", assignment.Id));

        ui.Duplicate.Should().BeFalse();
        mcp.Duplicate.Should().BeFalse();
        ((ReadingErrorDto)mcp.Data!).Code.Should().Be("assignment_not_found", "the second client executes fresh against the already-removed row");
        mcp.StateVersion.Should().Be(ui.StateVersion, "a rejection never bumps");
    }

    // --- harness ---------------------------------------------------------------

    private HarnessContext Harness()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc));
        return new HarnessContext(factory, clock, new ReadingTrainingService(factory, clock));
    }

    private static string NextVersion(string version) =>
        (long.TryParse(version, out var parsed) ? parsed + 1 : 1).ToString();

    private sealed record HarnessContext(
        TestContextFactory Factory,
        MutableReadingClock Clock,
        ReadingTrainingService Service)
    {
        public Task<ReadingCommandResultDto> Init() => Service.InitializeProgrammeAsync("setup", Guid.NewGuid().ToString("N"));

        public async Task<Guid> AddBook(string title)
        {
            await using var db = Factory.CreateDbContext();
            var book = new PhysicalBookModel { Title = title };
            db.Books.Add(book);
            await db.SaveChangesAsync();
            return book.Id;
        }

        public async Task<string> Version()
        {
            var dashboard = await Service.GetDashboardAsync();
            return ((ReadingDashboardDto)dashboard.Data!).Programme.StateVersion;
        }

        public async Task SetStatus(Guid assignmentId, ReadingAssignmentStatus status)
        {
            await using var db = Factory.CreateDbContext();
            var row = await db.ReadingBookAssignments.SingleAsync(x => x.Id == assignmentId);
            row.Status = status;
            // CK_ReadingBookAssignments_DefaultSlot_Mode_Status: only Active
            // rows may hold a default sentinel, so a non-Active status must
            // release it or the save violates the CHECK constraint.
            if (status != ReadingAssignmentStatus.Active)
            {
                row.DefaultSlot = null;
            }
            await db.SaveChangesAsync();
        }

        public async Task SeedSession(Guid assignmentId, ReadingSessionStatus status)
        {
            await using var db = Factory.CreateDbContext();
            var assignment = await db.ReadingBookAssignments.Include(x => x.Book).SingleAsync(x => x.Id == assignmentId);
            var now = Clock.UtcNow;
            var session = new ReadingSession
            {
                BookAssignment = assignment,
                BookAssignmentId = assignment.Id,
                Book = assignment.Book,
                BookId = assignment.BookId,
                Mode = assignment.Mode,
                Status = status,
                OpenSlot = status is ReadingSessionStatus.Planned or ReadingSessionStatus.Active
                    or ReadingSessionStatus.Paused or ReadingSessionStatus.AwaitingFeedback
                    ? ReadingSession.OpenSentinel
                    : null,
                TargetMinutes = 40,
                PlannedTargetMinutes = 40,
                Constraint = ReadingConstraint.None,
                AccumulatedSeconds = 0,
                ReportedMinutes = null,
                Effort = 0,
                Focus = 0,
                RatingsSkipped = false,
                PlannedAt = now,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.ReadingSessions.Add(session);
            await db.SaveChangesAsync();
        }
    }

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
