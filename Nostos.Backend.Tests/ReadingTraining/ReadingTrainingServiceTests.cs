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

public sealed class ReadingTrainingServiceTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingTrainingServiceTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Initialize_is_idempotent_and_duplicate_returns_original_result()
    {
        var h = Harness();
        var first = await h.Service.InitializeProgrammeAsync("ui", "init-1");
        var duplicate = await h.Service.InitializeProgrammeAsync("ui", "init-1");
        var secondKey = await h.Service.InitializeProgrammeAsync("ui", "init-2");

        first.Reply.Should().Be(ReadingReplyFormatter.InitializedFresh);
        first.StateVersion.Should().Be("1");
        ((ReadingProgrammeDto)first.Data!).StateVersion.Should().Be("1");
        duplicate.Duplicate.Should().BeTrue();
        duplicate.Reply.Should().Be(first.Reply);
        secondKey.Reply.Should().Be(ReadingReplyFormatter.AlreadyInitialized);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingProgrammes.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Books_support_multiple_modes_defaults_completion_and_reordering()
    {
        var h = Harness();
        await h.Init();
        var candide = await h.AddBook("Candide", "Voltaire");
        var ethics = await h.AddBook("Nicomachean Ethics", "Aristotle");

        var endurance = await h.Service.AddBookAssignmentAsync(new("ui", "add-c", candide, ReadingMode.Endurance, true));
        var deep = await h.Service.AddBookAssignmentAsync(new("ui", "add-e", ethics, ReadingMode.Deep, true));
        var a1 = (ReadingBookAssignmentDto)endurance.Data!;
        var a2 = (ReadingBookAssignmentDto)deep.Data!;

        a1.IsDefault.Should().BeTrue();
        a2.IsDefault.Should().BeTrue();
        var reordered = await h.Service.ReorderQueueAsync(new("ui", "order", [a2.Id, a1.Id]));
        ((IReadOnlyList<ReadingBookAssignmentDto>)reordered.Data!).Select(x => x.Id).Should().ContainInOrder(a2.Id, a1.Id);
        var completed = await h.Service.CompleteBookAsync(new("ui", "finish", a1.Id));
        ((ReadingBookAssignmentDto)completed.Data!).Status.Should().Be(ReadingAssignmentStatus.Completed);

        var reactivated = await h.Service.AddBookAssignmentAsync(new(
            "ui", "return-c", candide, ReadingMode.Endurance, true));
        var returned = (ReadingBookAssignmentDto)reactivated.Data!;
        returned.Id.Should().Be(a1.Id, "returning a finished book must preserve its session history");
        returned.Status.Should().Be(ReadingAssignmentStatus.Active);
        returned.CompletedAt.Should().BeNull();
        returned.IsDefault.Should().BeTrue();
        reactivated.Reply.Should().Be(ReadingReplyFormatter.ReturnedToQueue("Candide"));
    }

    [Fact]
    public async Task Plan_uses_default_book_and_preserves_constrained_session_semantics()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide", "Voltaire");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        var planned = await h.Service.PlanSessionAsync(new(
            "ui", "plan", assignment.Id, ReadingMode.Endurance, 15, ReadingConstraint.None));
        var session = (ReadingSessionDto)planned.Data!;

        session.Status.Should().Be(ReadingSessionStatus.Planned);
        session.TargetMinutes.Should().Be(15);
        session.PlannedTargetMinutes.Should().Be(40);
        session.Constraint.Should().Be(ReadingConstraint.TimeConstrained);
        session.ProgressionEligible.Should().BeFalse();
        session.CountsAsFailure.Should().BeFalse();
        planned.Reply.Should().Contain("today's available load");
    }

    [Fact]
    public async Task Recovery_is_volume_only_and_uses_recovery_target()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Essays", "Montaigne");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Recovery, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        var planned = await h.Service.PlanSessionAsync(new(
            "ui", "plan", assignment.Id, ReadingMode.Recovery, 0));
        var session = (ReadingSessionDto)planned.Data!;

        session.TargetMinutes.Should().Be(20);
        session.ProgressionEligible.Should().BeFalse();
    }

    [Fact]
    public async Task Start_pause_resume_is_restart_safe_and_excludes_paused_time()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        var started = await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        started.Reply.Should().Contain("Started: 10:00");

        h.Clock.Advance(TimeSpan.FromMinutes(12));
        var paused = await h.Service.PauseSessionAsync(new("ui", "pause"));
        ((ReadingSessionDto)paused.Data!).AccumulatedSeconds.Should().Be(720);
        h.Clock.Advance(TimeSpan.FromMinutes(30));

        var restartedService = new ReadingTrainingService(h.Factory, h.Clock);
        var pausedStatus = await restartedService.GetStatusAsync();
        ((ReadingSessionDto)pausedStatus.Data!).AccumulatedSeconds.Should().Be(720);
        await restartedService.ResumeSessionAsync(new("ui", "resume"));
        h.Clock.Advance(TimeSpan.FromMinutes(3));
        var active = await restartedService.GetStatusAsync();
        ((ReadingSessionDto)active.Data!).AccumulatedSeconds.Should().Be(900);
    }

    [Fact]
    public async Task Duplicate_pause_does_not_accumulate_twice()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromMinutes(7));

        var first = await h.Service.PauseSessionAsync(new("ui", "pause-key"));
        var retry = await h.Service.PauseSessionAsync(new("ui", "pause-key"));

        retry.Duplicate.Should().BeTrue();
        ((ReadingSessionDto)retry.Data!).AccumulatedSeconds.Should().Be(420);
        retry.Reply.Should().Be(first.Reply);
    }

    [Fact]
    public async Task Concurrent_same_key_plan_creates_one_session_and_one_receipt()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide", "Voltaire");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;
        var request = new ReadingPlanSessionRequest("shared", "plan-once", assignment.Id, ReadingMode.Endurance, 40);

        var results = await Task.WhenAll(
            h.Service.PlanSessionAsync(request),
            h.Service.PlanSessionAsync(request));

        results.Count(x => x.Duplicate).Should().Be(1);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingSessions.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync(x => x.ClientId == "shared" && x.IdempotencyKey == "plan-once")).Should().Be(1);
    }

    [Fact]
    public async Task Invalid_transition_is_deterministic_and_does_not_mutate_session()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);

        var result = await h.Service.ResumeSessionAsync(new("ui", "resume-invalid"));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("invalid_transition");
        var status = await h.Service.GetStatusAsync();
        ((ReadingSessionDto)status.Data!).Status.Should().Be(ReadingSessionStatus.Planned);
        ((ReadingSessionDto)status.Data!).Id.Should().Be(session.Id);
    }

    [Fact]
    public async Task Dashboard_and_status_are_authoritative_snapshots()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);

        var dashboard = (ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!;
        var status = (ReadingSessionDto)(await h.Service.GetStatusAsync()).Data!;

        dashboard.Books.Should().ContainSingle();
        dashboard.OpenSession!.Id.Should().Be(session.Id);
        status.Id.Should().Be(session.Id);
        status.BookTitle.Should().Be("Candide");
    }

    [Fact]
    public async Task Complete_and_rate_use_exact_prompt_and_release_open_slot()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromMinutes(43));

        var completed = await h.Service.CompleteSessionAsync(new("ui", "done"));
        completed.Reply.Should().Be("Effort 1–10?\nFocus 1–10?");
        ((ReadingSessionDto)completed.Data!).Status.Should().Be(ReadingSessionStatus.AwaitingFeedback);
        var rated = await h.Service.RateSessionAsync(new("ui", "rate", 4, 8));
        var ratedSession = (ReadingSessionDto)rated.Data!;
        ratedSession.Status.Should().Be(ReadingSessionStatus.Completed);
        rated.Reply.Should().Contain("Candide").And.Contain("43 min").And.Contain("Effort 4/10").And.Contain("Focus 8/10");
        (await h.Service.GetStatusAsync()).Reply.Should().Be(ReadingReplyFormatter.NoActiveSession);
    }

    [Fact]
    public async Task Reported_minutes_override_measured_time_and_skip_closes_session()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromMinutes(12));

        var completed = await h.Service.CompleteSessionAsync(new("ui", "done", 19));
        ((ReadingSessionDto)completed.Data!).ReportedMinutes.Should().Be(19);
        var skipped = await h.Service.SkipRatingsAsync(new("ui", "skip"));
        ((ReadingSessionDto)skipped.Data!).RatingsSkipped.Should().BeTrue();
        ((ReadingSessionDto)skipped.Data!).Status.Should().Be(ReadingSessionStatus.Completed);
        ((ReadingSessionDto)skipped.Data!).CountsAsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task Stale_session_requires_actual_minutes_without_mutation()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromHours(9));

        var stale = await h.Service.CompleteSessionAsync(new("ui", "done"));
        ((ReadingErrorDto)stale.Data!).Code.Should().Be("needs_actual_minutes");
        ((ReadingSessionDto)(await h.Service.GetStatusAsync()).Data!).Status.Should().Be(ReadingSessionStatus.Active);
        await using (var verifyRejected = h.Factory.CreateDbContext())
        {
            var persisted = await verifyRejected.ReadingSessions.SingleAsync(x => x.Id == session.Id);
            persisted.AccumulatedSeconds.Should().Be(0);
            persisted.MeasuredSeconds.Should().Be(0);
        }
        var recovered = await h.Service.CompleteSessionAsync(new("ui", "actual", 35));
        ((ReadingSessionDto)recovered.Data!).ReportedMinutes.Should().Be(35);
    }

    [Fact]
    public async Task Invalid_reported_minutes_do_not_persist_elapsed_time()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromMinutes(10));

        var rejected = await h.Service.CompleteSessionAsync(new("ui", "invalid-minutes", 0));

        ((ReadingErrorDto)rejected.Data!).Code.Should().Be("invalid_minutes");
        await using var verify = h.Factory.CreateDbContext();
        var persisted = await verify.ReadingSessions.SingleAsync(x => x.Id == session.Id);
        persisted.Status.Should().Be(ReadingSessionStatus.Active);
        persisted.AccumulatedSeconds.Should().Be(0);
        persisted.MeasuredSeconds.Should().Be(0);
    }

    [Fact]
    public async Task Cancel_releases_slot_without_completed_training_evidence()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromMinutes(5));

        var cancelled = await h.Service.CancelSessionAsync(new("ui", "cancel"));
        ((ReadingSessionDto)cancelled.Data!).Status.Should().Be(ReadingSessionStatus.Cancelled);
        (await h.Service.GetStatusAsync()).Data.Should().BeNull();
        var history = (IReadOnlyList<ReadingSessionDto>)(await h.Service.GetHistoryAsync()).Data!;
        history.Should().ContainSingle(x => x.Status == ReadingSessionStatus.Cancelled);
    }

    [Fact]
    public async Task Captures_are_verbatim_idempotent_and_inbox_items_resolve()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        const string text = "  Is cultivation another form of vanity?  ";
        var request = new ReadingCaptureRequest("telegram", "capture-1", text, ReadingCaptureType.Question, SessionId: session.Id, ExternalId: "msg-42");

        var first = await h.Service.CaptureAsync(request);
        var retry = await h.Service.CaptureAsync(request);
        ((ReadingCaptureDto)first.Data!).Text.Should().Be(text);
        retry.Duplicate.Should().BeTrue();
        var inbox = (IReadOnlyList<ReadingCaptureDto>)(await h.Service.ListInboxAsync()).Data!;
        inbox.Should().ContainSingle().Which.Text.Should().Be(text);
        var resolved = await h.Service.ResolveCaptureAsync(inbox[0].Id, new("ui", "resolve", false));
        ((ReadingCaptureDto)resolved.Data!).Resolved.Should().BeTrue();
        ((IReadOnlyList<ReadingCaptureDto>)(await h.Service.ListInboxAsync()).Data!).Should().BeEmpty();
    }

    [Fact]
    public async Task Promote_capture_appends_verbatim_text_to_same_book_note()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        var capture = (ReadingCaptureDto)(await h.Service.CaptureAsync(new(
            "ui", "capture", "The garden is a discipline.", ReadingCaptureType.Thought, SessionId: session.Id))).Data!;
        Guid noteId;
        await using (var db = h.Factory.CreateDbContext())
        {
            var note = new NoteModel { BookId = session.BookId, Content = "Existing note" };
            db.Notes.Add(note);
            await db.SaveChangesAsync();
            noteId = note.Id;
        }

        var promoted = await h.Service.PromoteCaptureToNoteAsync(capture.Id, new("ui", "promote", noteId));
        ((ReadingCaptureDto)promoted.Data!).PromotedNoteId.Should().Be(noteId);
        await using var verify = h.Factory.CreateDbContext();
        (await verify.Notes.SingleAsync(x => x.Id == noteId)).Content.Should().Be("Existing note\n\nThe garden is a discipline.");
    }

    [Fact]
    public async Task Resolve_keep_requires_a_valid_same_book_note_without_partial_mutation()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        var capture = (ReadingCaptureDto)(await h.Service.CaptureAsync(new(
            "ui", "capture-keep", "Keep this question.", ReadingCaptureType.Question,
            SessionId: session.Id))).Data!;

        var rejected = await h.Service.ResolveCaptureAsync(capture.Id,
            new("ui", "resolve-keep", true, NoteId: null));

        ((ReadingErrorDto)rejected.Data!).Code.Should().Be("note_required");
        await using var verify = h.Factory.CreateDbContext();
        var persisted = await verify.ReadingCaptures.SingleAsync(x => x.Id == capture.Id);
        persisted.Resolved.Should().BeFalse();
        persisted.PromotedNoteId.Should().BeNull();
    }

    // --- dashboard current-week summary ---------------------------------------
    // The harness clock starts at 2026-08-09 08:00 UTC = Sunday 10:00 CEST,
    // i.e. ISO week 32 2026: [2026-08-02T22:00:00Z, 2026-08-09T22:00:00Z).
    private static readonly DateTime Week32StartUtc = new(2026, 8, 2, 22, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week33StartUtc = new(2026, 8, 9, 22, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Dashboard_current_week_is_a_non_null_zero_summary_once_initialized()
    {
        var h = Harness();
        await h.Init();

        var week = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek;

        week.Should().NotBeNull();
        week!.WeekKey.Should().Be("2026-W32");
        week.CompletedSessions.Should().Be(0);
        week.QualifyingSessions.Should().Be(0);
        week.VolumeMinutes.Should().Be(0);
        week.CompletionThreshold.Should().Be(ReadingProgressionPolicy.IncreaseCompletionRate);
        week.ReviewCommitted.Should().BeFalse();
    }

    [Fact]
    public async Task Dashboard_current_week_mixes_modes_statuses_and_constraints()
    {
        var h = Harness();
        await h.Init();
        // Three qualifying endurance, one qualifying deep.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);
        // Constrained: volume only, never qualifying evidence.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(98), 2400,
            effort: 5, focus: 8, constraint: ReadingConstraint.TimeConstrained);
        // Recovery: volume only by policy, even when unconstrained and rated.
        await SeedSession(h, ReadingMode.Recovery, Week32StartUtc.AddHours(122), 1200, effort: 5, focus: 8);
        // AwaitingFeedback: counts as completed volume, but cannot qualify yet.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(146), 2400,
            status: ReadingSessionStatus.AwaitingFeedback);

        var week = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek!;

        week.WeekKey.Should().Be("2026-W32");
        week.CompletedSessions.Should().Be(7);
        week.QualifyingSessions.Should().Be(4);
        week.VolumeMinutes.Should().Be(250);
        week.CompletionThreshold.Should().Be(ReadingProgressionPolicy.IncreaseCompletionRate);
        week.ReviewCommitted.Should().BeFalse();
    }

    [Fact]
    public async Task Dashboard_current_week_boundary_follows_stockholm_local_week()
    {
        var h = Harness();
        await h.Init();
        // Sunday 2026-08-09 22:30 CEST = 20:30 UTC still belongs to ISO week 32.
        await SeedSession(h, ReadingMode.Endurance, new DateTime(2026, 8, 9, 20, 30, 0, DateTimeKind.Utc),
            2400, effort: 5, focus: 8);

        // Sunday 23:30 CEST (21:30 UTC): the local date is still week 32.
        h.Clock.Advance(TimeSpan.FromHours(13) + TimeSpan.FromMinutes(30));
        var sunday = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek!;
        sunday.WeekKey.Should().Be("2026-W32");
        sunday.CompletedSessions.Should().Be(1);
        sunday.VolumeMinutes.Should().Be(40);

        // Monday 10:00 CEST (08:00 UTC): the local date is now week 33 and the
        // Sunday session no longer counts toward the current week.
        h.Clock.Advance(TimeSpan.FromHours(10) + TimeSpan.FromMinutes(30));
        var monday = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek!;
        monday.WeekKey.Should().Be("2026-W33");
        monday.CompletedSessions.Should().Be(0);
        monday.QualifyingSessions.Should().Be(0);
        monday.VolumeMinutes.Should().Be(0);

        // Monday 00:30 CEST = Sunday 22:30 UTC is the new week's first session.
        await SeedSession(h, ReadingMode.Endurance, new DateTime(2026, 8, 9, 22, 30, 0, DateTimeKind.Utc),
            2400, effort: 5, focus: 8);
        var mondayWithSession = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek!;
        mondayWithSession.WeekKey.Should().Be("2026-W33");
        mondayWithSession.CompletedSessions.Should().Be(1);
        mondayWithSession.QualifyingSessions.Should().Be(1);
        mondayWithSession.VolumeMinutes.Should().Be(40);
    }

    [Fact]
    public async Task Dashboard_current_week_review_committed_flag_reflects_persisted_review()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);

        var before = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek!;
        before.ReviewCommitted.Should().BeFalse();
        before.VolumeMinutes.Should().Be(150);
        before.QualifyingSessions.Should().Be(4);

        var committed = await h.Service.CommitWeeklyReviewAsync(new("ui", "commit-w32", 2026, 32));
        committed.StateVersion.Should().Be("2");

        var after = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).CurrentWeek!;
        after.WeekKey.Should().Be("2026-W32");
        after.ReviewCommitted.Should().BeTrue();
        after.CompletedSessions.Should().Be(4);
        after.QualifyingSessions.Should().Be(4);
        after.VolumeMinutes.Should().Be(150);
    }

    private async Task SeedSession(
        HarnessContext h,
        ReadingMode mode,
        DateTime completedAtUtc,
        int accumulatedSeconds,
        int effort = 0,
        int focus = 0,
        ReadingConstraint constraint = ReadingConstraint.None,
        ReadingSessionStatus status = ReadingSessionStatus.Completed,
        int? plannedTargetMinutes = null)
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
            CreatedAt = completedAtUtc,
            StartedAt = completedAtUtc,
        };
        var planned = plannedTargetMinutes ?? mode switch
        {
            ReadingMode.Deep => 30,
            ReadingMode.Recovery => 20,
            _ => 40,
        };
        var session = new ReadingSession
        {
            BookAssignment = assignment,
            BookAssignmentId = assignment.Id,
            Book = book,
            BookId = book.Id,
            Mode = mode,
            Status = status,
            OpenSlot = status is ReadingSessionStatus.Planned or ReadingSessionStatus.Active
                or ReadingSessionStatus.Paused or ReadingSessionStatus.AwaitingFeedback
                ? ReadingSession.OpenSentinel
                : null,
            TargetMinutes = planned,
            PlannedTargetMinutes = planned,
            Constraint = constraint,
            AccumulatedSeconds = accumulatedSeconds,
            ReportedMinutes = null,
            Effort = effort,
            Focus = focus,
            RatingsSkipped = false,
            CompletedAt = completedAtUtc,
            PlannedAt = completedAtUtc,
            CreatedAt = completedAtUtc,
            UpdatedAt = completedAtUtc,
        };
        db.Books.Add(book);
        db.ReadingBookAssignments.Add(assignment);
        db.ReadingSessions.Add(session);
        await db.SaveChangesAsync();
    }

    private HarnessContext Harness()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc));
        return new HarnessContext(factory, clock, new ReadingTrainingService(factory, clock));
    }

    private sealed record HarnessContext(
        TestContextFactory Factory,
        MutableReadingClock Clock,
        ReadingTrainingService Service)
    {
        public Task<ReadingCommandResultDto> Init() => Service.InitializeProgrammeAsync("setup", Guid.NewGuid().ToString("N"));

        public async Task<Guid> AddBook(string title, string? author = null)
        {
            await using var db = Factory.CreateDbContext();
            var book = new PhysicalBookModel { Title = title, Author = author };
            db.Books.Add(book);
            await db.SaveChangesAsync();
            return book.Id;
        }

        public async Task<ReadingSessionDto> PlanDefault(string title, ReadingMode mode)
        {
            var book = await AddBook(title);
            var added = await Service.AddBookAssignmentAsync(new("setup", $"add-{book:N}", book, mode, true));
            var assignment = (ReadingBookAssignmentDto)added.Data!;
            var planned = await Service.PlanSessionAsync(new("ui", $"plan-{book:N}", assignment.Id, mode, 0));
            return (ReadingSessionDto)planned.Data!;
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
