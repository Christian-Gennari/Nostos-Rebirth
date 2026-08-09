using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

public sealed class ReadingTrainingService : IReadingTrainingService
{
    private static readonly SemaphoreSlim CommandGate = new(1, 1);
    private static readonly JsonSerializerOptions ReceiptJson = CreateReceiptJson();

    private readonly IDbContextFactory<NostosDbContext> _contexts;
    private readonly IReadingClock _clock;
    private readonly ReadingTrainingOptions _options;

    public ReadingTrainingService(
        IDbContextFactory<NostosDbContext> contexts,
        IReadingClock clock,
        ReadingTrainingOptions? options = null)
    {
        _contexts = contexts;
        _clock = clock;
        _options = options ?? new ReadingTrainingOptions();
    }

    public Task<ReadingCommandResultDto> InitializeProgrammeAsync(
        string clientId, string idempotencyKey, CancellationToken ct = default) =>
        MutateAsync(clientId, idempotencyKey, "InitializeProgramme", async (db, token) =>
        {
            var programme = await db.ReadingProgrammes.SingleOrDefaultAsync(token);
            if (programme is not null)
                return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyInitialized, ToDto(programme), programme.StateVersion));

            programme = new ReadingProgramme
            {
                Id = ReadingProgramme.WellKnownId,
                SingletonSlot = ReadingProgramme.SingletonSentinel,
                TimezoneId = _options.TimezoneId,
                EnduranceTargetMinutes = 40,
                DeepTargetMinutes = 30,
                RecoveryTargetMinutes = 20,
                EnduranceEstablishedMinutes = 40,
                DeepEstablishedMinutes = 30,
                RecoveryEstablishedMinutes = 20,
                CreatedAt = Now,
                UpdatedAt = Now,
            };
            db.ReadingProgrammes.Add(programme);
            return Outcome.Changed(Result(ReadingReplyFormatter.InitializedFresh, ToDto(programme), "0"));
        }, ct);

    public async Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var programme = await db.ReadingProgrammes.AsNoTracking().SingleOrDefaultAsync(ct);
        if (programme is null) return Failure("not_initialized", "Reading training is not initialized.");

        var books = await db.ReadingBookAssignments.AsNoTracking().Include(x => x.Book)
            .OrderBy(x => x.QueueOrder).ThenBy(x => x.CreatedAt).ToListAsync(ct);
        var open = await OpenSessionQuery(db).AsNoTracking().SingleOrDefaultAsync(ct);
        var dashboard = new ReadingDashboardDto(
            ToDto(programme), books.Select(ToDto).ToList(), open is null ? null : ToDto(open), null);
        return Result(ReadingReplyFormatter.Dashboard, dashboard, programme.StateVersion);
    }

    public async Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var programme = await db.ReadingProgrammes.AsNoTracking().SingleOrDefaultAsync(ct);
        var version = programme?.StateVersion ?? "0";
        var session = await OpenSessionQuery(db).AsNoTracking().SingleOrDefaultAsync(ct);
        if (session is null) return Result(ReadingReplyFormatter.NoActiveSession, null, version);
        var dto = ToDto(session);
        return Result(StatusReply(dto), dto, version);
    }

    public async Task<ReadingCommandResultDto> GetHistoryAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var programme = await db.ReadingProgrammes.AsNoTracking().SingleOrDefaultAsync(ct);
        var sessions = await db.ReadingSessions.AsNoTracking().Include(x => x.Book)
            .Where(x => x.Status == ReadingSessionStatus.Completed || x.Status == ReadingSessionStatus.Cancelled)
            .OrderByDescending(x => x.CompletedAt).ThenByDescending(x => x.CreatedAt)
            .ToListAsync(ct);
        var data = sessions.Select(ToDto).ToList();
        return Result(ReadingReplyFormatter.History(data.Count), data, programme?.StateVersion ?? "0");
    }

    public Task<ReadingCommandResultDto> AddBookAssignmentAsync(
        ReadingAddBookAssignmentRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "AddBookAssignment", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var book = await db.Books.SingleOrDefaultAsync(x => x.Id == request.BookId, token);
            if (book is null) return Outcome.Unchanged(Failure("book_not_found", ReadingReplyFormatter.BookNotFound, programme.StateVersion));
            var existing = await db.ReadingBookAssignments.Include(x => x.Book)
                .SingleOrDefaultAsync(x => x.BookId == request.BookId && x.Mode == request.Mode && x.Status != ReadingAssignmentStatus.Archived, token);
            if (existing is not null)
                return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyInQueue(book.Title), ToDto(existing), programme.StateVersion));

            if (request.MakeDefault)
            {
                var oldDefaults = await db.ReadingBookAssignments
                    .Where(x => x.Mode == request.Mode && x.DefaultSlot != null).ToListAsync(token);
                foreach (var old in oldDefaults) old.DefaultSlot = null;
                if (oldDefaults.Count > 0) await db.SaveChangesAsync(token);
            }
            var nextOrder = (await db.ReadingBookAssignments.Select(x => (int?)x.QueueOrder).MaxAsync(token) ?? -1) + 1;
            var assignment = new ReadingBookAssignment
            {
                BookId = book.Id,
                Book = book,
                Mode = request.Mode,
                Status = ReadingAssignmentStatus.Active,
                QueueOrder = nextOrder,
                DefaultSlot = request.MakeDefault ? ReadingBookAssignment.DefaultSentinelFor(request.Mode) : null,
                CreatedAt = Now,
                StartedAt = Now,
            };
            db.ReadingBookAssignments.Add(assignment);
            return Outcome.Changed(Result(ReadingReplyFormatter.AddedToQueue(book.Title), ToDto(assignment), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> SetDefaultBookAsync(
        ReadingSetDefaultBookRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "SetDefaultBook", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var assignment = await db.ReadingBookAssignments.Include(x => x.Book)
                .SingleOrDefaultAsync(x => x.Id == request.BookAssignmentId, token);
            if (assignment is null) return Outcome.Unchanged(Failure("assignment_not_found", ReadingReplyFormatter.NoMatchingBook, programme.StateVersion));
            if (assignment.Mode != request.Mode || assignment.Status != ReadingAssignmentStatus.Active)
                return Outcome.Unchanged(Failure("invalid_assignment", ReadingReplyFormatter.NotAssignedToMode(assignment.Book?.Title ?? "Book", request.Mode.ToString().ToLowerInvariant()), programme.StateVersion));
            if (assignment.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(request.Mode))
                return Outcome.Unchanged(Result(ReadingReplyFormatter.SetDefault(assignment.Book?.Title ?? "Book", request.Mode.ToString().ToLowerInvariant()), ToDto(assignment), programme.StateVersion));

            var oldDefaults = await db.ReadingBookAssignments
                .Where(x => x.Mode == request.Mode && x.DefaultSlot != null && x.Id != assignment.Id).ToListAsync(token);
            foreach (var old in oldDefaults) old.DefaultSlot = null;
            if (oldDefaults.Count > 0) await db.SaveChangesAsync(token);
            assignment.DefaultSlot = ReadingBookAssignment.DefaultSentinelFor(request.Mode);
            return Outcome.Changed(Result(ReadingReplyFormatter.SetDefault(assignment.Book?.Title ?? "Book", request.Mode.ToString().ToLowerInvariant()), ToDto(assignment), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> CompleteBookAsync(
        ReadingCompleteBookRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "CompleteBook", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var assignment = await db.ReadingBookAssignments.Include(x => x.Book)
                .SingleOrDefaultAsync(x => x.Id == request.BookAssignmentId, token);
            if (assignment is null) return Outcome.Unchanged(Failure("assignment_not_found", ReadingReplyFormatter.NoMatchingBook, programme.StateVersion));
            if (assignment.Status == ReadingAssignmentStatus.Completed)
                return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyFinished(assignment.Book?.Title ?? "Book"), ToDto(assignment), programme.StateVersion));
            var hasOpen = await db.ReadingSessions.AnyAsync(x => x.BookAssignmentId == assignment.Id && x.OpenSlot != null, token);
            if (hasOpen) return Outcome.Unchanged(Failure("book_has_open_session", "Finish or cancel the open session first.", programme.StateVersion));
            assignment.Status = ReadingAssignmentStatus.Completed;
            assignment.DefaultSlot = null;
            assignment.CompletedAt = Now;
            return Outcome.Changed(Result(ReadingReplyFormatter.MarkedFinished(assignment.Book?.Title ?? "Book"), ToDto(assignment), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> ReorderQueueAsync(
        ReadingReorderQueueRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "ReorderQueue", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            if (request.AssignmentIds.Count == 0)
                return Outcome.Unchanged(Result(ReadingReplyFormatter.NothingToReorder, Array.Empty<ReadingBookAssignmentDto>(), programme.StateVersion));
            if (request.AssignmentIds.Distinct().Count() != request.AssignmentIds.Count)
                return Outcome.Unchanged(Failure("invalid_order", "Queue order contains duplicate books.", programme.StateVersion));
            var assignments = await db.ReadingBookAssignments.Include(x => x.Book)
                .Where(x => request.AssignmentIds.Contains(x.Id)).ToListAsync(token);
            if (assignments.Count != request.AssignmentIds.Count)
                return Outcome.Unchanged(Failure("assignment_not_found", ReadingReplyFormatter.NoMatchingBook, programme.StateVersion));
            var byId = assignments.ToDictionary(x => x.Id);
            for (var i = 0; i < request.AssignmentIds.Count; i++) byId[request.AssignmentIds[i]].QueueOrder = i;
            var data = request.AssignmentIds.Select(id => ToDto(byId[id])).ToList();
            return Outcome.Changed(Result(ReadingReplyFormatter.Reordered, data, programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> PlanSessionAsync(
        ReadingPlanSessionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "PlanSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var alreadyOpen = await OpenSessionQuery(db).AsNoTracking().SingleOrDefaultAsync(token);
            if (alreadyOpen is not null)
                return Outcome.Unchanged(Failure("already_active", StatusReply(ToDto(alreadyOpen)), programme.StateVersion));
            var assignment = await db.ReadingBookAssignments.Include(x => x.Book)
                .SingleOrDefaultAsync(x => x.Id == request.BookAssignmentId, token);
            if (assignment is null || assignment.Status != ReadingAssignmentStatus.Active)
                return Outcome.Unchanged(Failure("assignment_not_found", ReadingReplyFormatter.NoMatchingBook, programme.StateVersion));
            if (assignment.Mode != request.Mode)
                return Outcome.Unchanged(Failure("mode_mismatch", ReadingReplyFormatter.NotAssignedToMode(assignment.Book?.Title ?? "Book", request.Mode.ToString().ToLowerInvariant()), programme.StateVersion));

            var planned = TargetFor(programme, request.Mode);
            var requested = request.TargetMinutes > 0 ? request.TargetMinutes : planned;
            var constrained = request.Constraint != ReadingConstraint.None || requested < planned;
            var target = request.Mode == ReadingMode.Recovery && !constrained
                ? Math.Clamp(requested, _options.RecoveryMinMinutes, _options.RecoveryMaxMinutes)
                : Math.Max(1, Math.Min(requested, planned));
            var session = NewSession(assignment, request.Mode, target, planned, request.Constraint, ReadingSessionStatus.Planned);
            db.ReadingSessions.Add(session);
            return Outcome.Changed(Result(
                ReadingReplyFormatter.Plan(ReadingReplyFormatter.ModeWord(request.Mode), target, assignment.Book?.Title ?? "Book", constrained),
                ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> StartSessionAsync(
        ReadingStartSessionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "StartSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var query = OpenSessionQuery(db);
            var session = request.SessionId is Guid id
                ? await query.SingleOrDefaultAsync(x => x.Id == id, token)
                : await query.SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_planned_session", "No planned reading session.", programme.StateVersion));
            if (session.Status != ReadingSessionStatus.Planned)
                return Outcome.Unchanged(Failure("invalid_transition", StatusReply(ToDto(session)), programme.StateVersion));
            Start(session);
            return Outcome.Changed(Result(
                ReadingReplyFormatter.Start(session.Book?.Title ?? "Book", ReadingReplyFormatter.ModeUpper(session.Mode), session.TargetMinutes, ReadingReplyFormatter.StartTime(Now)),
                ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> StartNewSessionAsync(
        ReadingStartNewSessionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "StartNewSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            if (await db.ReadingSessions.AnyAsync(x => x.OpenSlot != null, token))
                return Outcome.Unchanged(Failure("already_active", "A reading session is already open.", programme.StateVersion));
            var mode = request.Mode ?? ReadingMode.Endurance;
            ReadingBookAssignment? assignment;
            if (request.BookAssignmentId is Guid id)
                assignment = await db.ReadingBookAssignments.Include(x => x.Book).SingleOrDefaultAsync(x => x.Id == id, token);
            else
                assignment = await db.ReadingBookAssignments.Include(x => x.Book)
                    .SingleOrDefaultAsync(x => x.Mode == mode && x.DefaultSlot == ReadingBookAssignment.DefaultSentinelFor(mode) && x.Status == ReadingAssignmentStatus.Active, token);
            if (assignment is null) return Outcome.Unchanged(Failure("no_active_book", ReadingReplyFormatter.NoActiveBook(mode.ToString().ToLowerInvariant()), programme.StateVersion));
            if (request.Mode is not null && assignment.Mode != mode)
                return Outcome.Unchanged(Failure("mode_mismatch", ReadingReplyFormatter.NotAssignedToMode(assignment.Book?.Title ?? "Book", mode.ToString().ToLowerInvariant()), programme.StateVersion));
            mode = assignment.Mode;
            var target = TargetFor(programme, mode);
            var session = NewSession(assignment, mode, target, target, ReadingConstraint.None, ReadingSessionStatus.Active);
            session.StartedAt = Now;
            session.LastStartedAt = Now;
            db.ReadingSessions.Add(session);
            return Outcome.Changed(Result(
                ReadingReplyFormatter.Start(assignment.Book?.Title ?? "Book", ReadingReplyFormatter.ModeUpper(mode), target, ReadingReplyFormatter.StartTime(Now)),
                ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> PauseSessionAsync(
        ReadingSessionCommandRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "PauseSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_active_session", ReadingReplyFormatter.NoSessionToPause, programme.StateVersion));
            if (session.Status == ReadingSessionStatus.Paused)
                return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyPaused, ToDto(session), programme.StateVersion));
            if (session.Status != ReadingSessionStatus.Active)
                return Outcome.Unchanged(Failure("invalid_transition", session.Status == ReadingSessionStatus.Planned ? ReadingReplyFormatter.NotStartedToPause : ReadingReplyFormatter.FinishedRateOrSkip, programme.StateVersion));
            Accumulate(session);
            session.Status = ReadingSessionStatus.Paused;
            session.PausedAt = Now;
            session.LastStartedAt = null;
            session.UpdatedAt = Now;
            return Outcome.Changed(Result(ReadingReplyFormatter.Paused(session.AccumulatedSeconds / 60), ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> ResumeSessionAsync(
        ReadingSessionCommandRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "ResumeSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_session", ReadingReplyFormatter.NoSessionToResume, programme.StateVersion));
            if (session.Status != ReadingSessionStatus.Paused)
                return Outcome.Unchanged(Failure("invalid_transition", ReadingReplyFormatter.NothingToResume, programme.StateVersion));
            session.Status = ReadingSessionStatus.Active;
            session.LastStartedAt = Now;
            session.PausedAt = null;
            session.UpdatedAt = Now;
            return Outcome.Changed(Result(ReadingReplyFormatter.Resumed(session.Book?.Title ?? "Book"), ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> CompleteSessionAsync(
        ReadingCompleteSessionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "CompleteSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_active_session", ReadingReplyFormatter.NoActiveSessionToComplete, programme.StateVersion));
            if (session.Status == ReadingSessionStatus.Planned)
                return Outcome.Unchanged(Failure("not_started", ReadingReplyFormatter.NotStartedToComplete, programme.StateVersion));
            if (session.Status == ReadingSessionStatus.AwaitingFeedback)
                return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyLoggedHowDidItGo, ToDto(session), programme.StateVersion));
            if (session.Status == ReadingSessionStatus.Active) Accumulate(session);
            if (request.ReportedMinutes is <= 0)
                return Outcome.Unchanged(Failure("invalid_minutes", "Actual minutes must be greater than zero.", programme.StateVersion));
            var isStale = session.StartedAt is not null && Now - session.StartedAt.Value > TimeSpan.FromHours(_options.StaleAfterHours);
            if (isStale && request.ReportedMinutes is null)
                return Outcome.Unchanged(Failure("needs_actual_minutes", ReadingReplyFormatter.StaleActive(session.Book?.Title ?? "Book"), programme.StateVersion));
            session.ReportedMinutes = request.ReportedMinutes;
            session.Status = ReadingSessionStatus.AwaitingFeedback;
            session.RatingRequestedAt = Now;
            session.CompletedAt = Now;
            session.LastStartedAt = null;
            session.PausedAt = null;
            session.UpdatedAt = Now;
            return Outcome.Changed(Result(ReadingReplyFormatter.RatePrompt, ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> RateSessionAsync(
        ReadingRateSessionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "RateSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            if (request.Effort is < 1 or > 10 || request.Focus is < 1 or > 10 || request.Rating is < 0 or > 5)
                return Outcome.Unchanged(Failure("invalid_ratings", ReadingReplyFormatter.GiveRatings, programme.StateVersion));
            var session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_ratings_pending", ReadingReplyFormatter.NoRatingsPending, programme.StateVersion));
            if (session.Status != ReadingSessionStatus.AwaitingFeedback)
                return Outcome.Unchanged(Failure("invalid_transition", ReadingReplyFormatter.NoRatingsPending, programme.StateVersion));
            session.Effort = request.Effort;
            session.Focus = request.Focus;
            session.Rating = request.Rating;
            session.RatingsSkipped = false;
            CloseCompleted(session);
            var minutes = EffectiveMinutes(session);
            return Outcome.Changed(Result(
                ReadingReplyFormatter.LoggedRating(session.Book?.Title ?? "Book", minutes, request.Effort, request.Focus),
                ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> SkipRatingsAsync(
        ReadingSkipRatingsRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "SkipRatings", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_ratings_pending", ReadingReplyFormatter.NoRatingsPendingSkip, programme.StateVersion));
            if (session.Status != ReadingSessionStatus.AwaitingFeedback)
                return Outcome.Unchanged(Failure("invalid_transition", ReadingReplyFormatter.NoRatingsPendingSkip, programme.StateVersion));
            session.RatingsSkipped = true;
            CloseCompleted(session);
            return Outcome.Changed(Result(ReadingReplyFormatter.RatingsSkipped, ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> CancelSessionAsync(
        ReadingSessionCommandRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "CancelSession", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            if (session is null) return Outcome.Unchanged(Failure("no_active_session", ReadingReplyFormatter.NoSessionToCancel, programme.StateVersion));
            if (session.Status == ReadingSessionStatus.Active) Accumulate(session);
            session.Status = ReadingSessionStatus.Cancelled;
            session.OpenSlot = null;
            session.LastStartedAt = null;
            session.PausedAt = null;
            session.CompletedAt = Now;
            session.UpdatedAt = Now;
            return Outcome.Changed(Result(ReadingReplyFormatter.Cancelled, ToDto(session), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> CaptureAsync(
        ReadingCaptureRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "Capture", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            if (string.IsNullOrWhiteSpace(request.Text))
                return Outcome.Unchanged(Failure("empty_capture", ReadingReplyFormatter.NothingToCapture, programme.StateVersion));
            if (!string.IsNullOrWhiteSpace(request.ExternalId))
            {
                var existing = await db.ReadingCaptures.AsNoTracking().SingleOrDefaultAsync(x => x.ExternalId == request.ExternalId, token);
                if (existing is not null)
                    return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyCaptured, ToDto(existing), programme.StateVersion));
            }
            ReadingSession? session = null;
            if (request.SessionId is Guid sessionId)
                session = await db.ReadingSessions.SingleOrDefaultAsync(x => x.Id == sessionId, token);
            else
                session = await OpenSessionQuery(db).SingleOrDefaultAsync(token);
            var bookId = request.BookId ?? session?.BookId;
            if (bookId is null || !await db.Books.AnyAsync(x => x.Id == bookId.Value, token))
                return Outcome.Unchanged(Failure("no_active_book", ReadingReplyFormatter.NoActiveBookToAttach, programme.StateVersion));
            var capture = new ReadingCapture
            {
                Text = request.Text,
                Type = request.Type,
                BookId = bookId.Value,
                SessionId = session?.Id,
                ExternalId = string.IsNullOrWhiteSpace(request.ExternalId) ? null : request.ExternalId,
                CreatedAt = Now,
            };
            db.ReadingCaptures.Add(capture);
            var reply = request.Type switch
            {
                ReadingCaptureType.Question => ReadingReplyFormatter.QuestionAdded,
                ReadingCaptureType.Bookmark => ReadingReplyFormatter.BookmarkAdded,
                _ => ReadingReplyFormatter.ThoughtCaptured,
            };
            return Outcome.Changed(Result(reply, ToDto(capture), programme.StateVersion));
        }, ct);

    public async Task<ReadingCommandResultDto> ListInboxAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var programme = await db.ReadingProgrammes.AsNoTracking().SingleOrDefaultAsync(ct);
        var captures = await db.ReadingCaptures.AsNoTracking()
            .Where(x => !x.Resolved && x.Type != ReadingCaptureType.Thought)
            .OrderBy(x => x.CreatedAt).ToListAsync(ct);
        var data = captures.Select(ToDto).ToList();
        return Result(data.Count == 0 ? ReadingReplyFormatter.InboxEmpty : ReadingReplyFormatter.InboxCount(data.Count), data, programme?.StateVersion ?? "0");
    }

    public Task<ReadingCommandResultDto> ResolveCaptureAsync(
        Guid captureId, ReadingResolveCaptureRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "ResolveCapture", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var capture = await db.ReadingCaptures.SingleOrDefaultAsync(x => x.Id == captureId, token);
            if (capture is null) return Outcome.Unchanged(Failure("capture_not_found", ReadingReplyFormatter.CaptureNotFound, programme.StateVersion));
            if (capture.Resolved) return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyDisposed, ToDto(capture), programme.StateVersion));
            capture.Resolved = true;
            capture.PromotedNoteId = request.Keep ? request.NoteId : null;
            return Outcome.Changed(Result(ReadingReplyFormatter.Disposed(1, request.Keep ? "promoted" : "dismissed"), ToDto(capture), programme.StateVersion));
        }, ct);

    public Task<ReadingCommandResultDto> PromoteCaptureToNoteAsync(
        Guid captureId, ReadingPromoteCaptureRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "PromoteCaptureToNote", async (db, token) =>
        {
            var programme = await ProgrammeAsync(db, token);
            if (programme is null) return Outcome.Unchanged(Failure("not_initialized", "Reading training is not initialized."));
            var capture = await db.ReadingCaptures.SingleOrDefaultAsync(x => x.Id == captureId, token);
            if (capture is null) return Outcome.Unchanged(Failure("capture_not_found", ReadingReplyFormatter.CaptureNotFound, programme.StateVersion));
            if (capture.Resolved) return Outcome.Unchanged(Result(ReadingReplyFormatter.AlreadyDisposed, ToDto(capture), programme.StateVersion));
            var note = await db.Notes.SingleOrDefaultAsync(x => x.Id == request.NoteId, token);
            if (note is null) return Outcome.Unchanged(Failure("note_not_found", ReadingReplyFormatter.NoteNotFound, programme.StateVersion));
            if (note.BookId != capture.BookId)
                return Outcome.Unchanged(Failure("note_book_mismatch", "The note belongs to a different book.", programme.StateVersion));
            note.Content = string.IsNullOrWhiteSpace(note.Content) ? capture.Text : $"{note.Content}\n\n{capture.Text}";
            capture.PromotedNoteId = note.Id;
            capture.Resolved = true;
            return Outcome.Changed(Result(ReadingReplyFormatter.Disposed(1, "promoted"), ToDto(capture), programme.StateVersion));
        }, ct);

    private async Task<ReadingCommandResultDto> MutateAsync(
        string clientId,
        string idempotencyKey,
        string commandKind,
        Func<NostosDbContext, CancellationToken, Task<Outcome>> command,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(idempotencyKey))
            return Failure("invalid_idempotency", "ClientId and IdempotencyKey are required.");

        await CommandGate.WaitAsync(ct);
        try
        {
            await using var db = await _contexts.CreateDbContextAsync(ct);
            var prior = await db.ReadingCommandReceipts.AsNoTracking()
                .SingleOrDefaultAsync(x => x.ClientId == clientId && x.IdempotencyKey == idempotencyKey, ct);
            if (prior is not null) return Deserialize(prior.ResponseJson) with { Duplicate = true };

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var outcome = await command(db, ct);
            var programme = db.ChangeTracker.Entries<ReadingProgramme>().Select(x => x.Entity).SingleOrDefault()
                ?? await db.ReadingProgrammes.SingleOrDefaultAsync(ct);
            var version = programme?.StateVersion ?? outcome.Result.StateVersion;
            if (outcome.DidChange && programme is not null)
            {
                version = NextVersion(programme.StateVersion);
                programme.StateVersion = version;
                programme.UpdatedAt = Now;
            }
            var resultData = outcome.Result.Data is ReadingProgrammeDto && programme is not null
                ? ToDto(programme)
                : outcome.Result.Data;
            var result = outcome.Result with { Data = resultData, StateVersion = version, Duplicate = false };
            db.ReadingCommandReceipts.Add(new ReadingCommandReceipt
            {
                ClientId = clientId,
                IdempotencyKey = idempotencyKey,
                CommandKind = commandKind,
                ResponseJson = Serialize(result),
                CreatedAt = Now,
            });
            try
            {
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return result;
            }
            catch (DbUpdateException)
            {
                await transaction.RollbackAsync(ct);
                await using var retryDb = await _contexts.CreateDbContextAsync(ct);
                var raced = await retryDb.ReadingCommandReceipts.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.ClientId == clientId && x.IdempotencyKey == idempotencyKey, ct);
                if (raced is not null) return Deserialize(raced.ResponseJson) with { Duplicate = true };
                throw;
            }
        }
        finally
        {
            CommandGate.Release();
        }
    }

    private ReadingSession NewSession(
        ReadingBookAssignment assignment,
        ReadingMode mode,
        int target,
        int plannedTarget,
        ReadingConstraint constraint,
        ReadingSessionStatus status) => new()
    {
        BookAssignmentId = assignment.Id,
        BookAssignment = assignment,
        BookId = assignment.BookId,
        Book = assignment.Book,
        Mode = mode,
        Status = status,
        OpenSlot = ReadingSession.OpenSentinel,
        TargetMinutes = target,
        PlannedTargetMinutes = plannedTarget,
        Constraint = constraint,
        PlannedAt = Now,
        CreatedAt = Now,
        UpdatedAt = Now,
    };

    private void Start(ReadingSession session)
    {
        session.Status = ReadingSessionStatus.Active;
        session.StartedAt ??= Now;
        session.LastStartedAt = Now;
        session.PausedAt = null;
        session.UpdatedAt = Now;
    }

    private void Accumulate(ReadingSession session)
    {
        if (session.LastStartedAt is null) return;
        var delta = Math.Max(0, (int)(Now - session.LastStartedAt.Value).TotalSeconds);
        session.AccumulatedSeconds += delta;
        if (session.StartedAt is not null)
            session.MeasuredSeconds = Math.Max(session.MeasuredSeconds, Math.Max(0, (int)(Now - session.StartedAt.Value).TotalSeconds));
    }

    private void CloseCompleted(ReadingSession session)
    {
        session.Status = ReadingSessionStatus.Completed;
        session.OpenSlot = null;
        session.LastStartedAt = null;
        session.PausedAt = null;
        session.CompletedAt ??= Now;
        session.UpdatedAt = Now;
    }

    private static int EffectiveMinutes(ReadingSession session) =>
        session.ReportedMinutes ?? Math.Max(0, (int)Math.Round(session.AccumulatedSeconds / 60.0, MidpointRounding.AwayFromZero));

    private static ReadingCaptureDto ToDto(ReadingCapture capture) => new(
        capture.Id, capture.Text, capture.Type, capture.BookId, capture.SessionId,
        capture.ExternalId, capture.Resolved, capture.PromotedNoteId, capture.CreatedAt);

    private ReadingSessionDto ToDto(ReadingSession session)
    {
        var accumulated = session.AccumulatedSeconds;
        var measured = session.MeasuredSeconds;
        if (session.Status == ReadingSessionStatus.Active && session.LastStartedAt is not null)
            accumulated += Math.Max(0, (int)(Now - session.LastStartedAt.Value).TotalSeconds);
        if (session.Status == ReadingSessionStatus.Active && session.StartedAt is not null)
            measured = Math.Max(measured, Math.Max(0, (int)(Now - session.StartedAt.Value).TotalSeconds));
        return new ReadingSessionDto(
            session.Id, session.BookAssignmentId, session.BookId, session.Book?.Title,
            session.Mode, session.Status, session.TargetMinutes, session.PlannedTargetMinutes,
            session.Constraint,
            session.Mode != ReadingMode.Recovery && session.Constraint == ReadingConstraint.None,
            false,
            accumulated, measured, session.ReportedMinutes, session.Effort, session.Focus,
            session.Rating, session.RatingsSkipped, session.PlannedAt, session.StartedAt,
            session.LastStartedAt, session.PausedAt, session.CompletedAt);
    }

    private static ReadingBookAssignmentDto ToDto(ReadingBookAssignment assignment) => new(
        assignment.Id, assignment.BookId, assignment.Book?.Title, assignment.Book?.Author,
        assignment.Mode, assignment.Status, assignment.QueueOrder, assignment.DefaultSlot is not null,
        assignment.CreatedAt, assignment.StartedAt, assignment.CompletedAt);

    private static ReadingProgrammeDto ToDto(ReadingProgramme programme) => new(
        programme.Id, programme.TimezoneId, programme.StateVersion,
        new ReadingTargetsDto(
            programme.EnduranceTargetMinutes, programme.DeepTargetMinutes, programme.RecoveryTargetMinutes,
            programme.EnduranceEstablishedMinutes, programme.DeepEstablishedMinutes, programme.RecoveryEstablishedMinutes),
        programme.DeloadActive);

    private static int TargetFor(ReadingProgramme programme, ReadingMode mode) => mode switch
    {
        ReadingMode.Deep => programme.DeepTargetMinutes,
        ReadingMode.Recovery => programme.RecoveryTargetMinutes,
        _ => programme.EnduranceTargetMinutes,
    };

    private static IQueryable<ReadingSession> OpenSessionQuery(NostosDbContext db) =>
        db.ReadingSessions.Include(x => x.Book).Include(x => x.BookAssignment).Where(x => x.OpenSlot != null);

    private static Task<ReadingProgramme?> ProgrammeAsync(NostosDbContext db, CancellationToken ct) =>
        db.ReadingProgrammes.SingleOrDefaultAsync(ct);

    private string StatusReply(ReadingSessionDto session)
    {
        var book = session.BookTitle ?? "Book";
        var minutes = session.AccumulatedSeconds / 60;
        return session.Status switch
        {
            ReadingSessionStatus.Planned => ReadingReplyFormatter.StatusPlanned(ReadingReplyFormatter.ModeWord(session.Mode), session.TargetMinutes, book),
            ReadingSessionStatus.Paused => ReadingReplyFormatter.StatusPaused(book, minutes),
            ReadingSessionStatus.Active => ReadingReplyFormatter.StatusActive(book, ReadingReplyFormatter.ModeWord(session.Mode), minutes, Math.Max(0, session.TargetMinutes - minutes)),
            ReadingSessionStatus.AwaitingFeedback => ReadingReplyFormatter.StatusAwaitingFeedback(session.ReportedMinutes ?? minutes),
            _ => ReadingReplyFormatter.NoActiveSession,
        };
    }

    private DateTime Now => DateTime.SpecifyKind(_clock.UtcNow, DateTimeKind.Utc);

    private static string NextVersion(string version) =>
        (long.TryParse(version, out var parsed) ? parsed + 1 : 1).ToString();

    private static ReadingCommandResultDto Result(string reply, object? data, string version) =>
        new(reply, data, version);

    private static ReadingCommandResultDto Failure(string code, string reply, string version = "0") =>
        new(reply, new ReadingErrorDto(code), version);

    private static string Serialize(ReadingCommandResultDto result) => JsonSerializer.Serialize(result, ReceiptJson);
    private static ReadingCommandResultDto Deserialize(string json) =>
        JsonSerializer.Deserialize<ReadingCommandResultDto>(json, ReceiptJson)
        ?? throw new InvalidOperationException("Stored reading command receipt is invalid.");

    private static JsonSerializerOptions CreateReceiptJson()
    {
        var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        options.Converters.Add(new ReadingCommandResultJsonConverter());
        return options;
    }

    private readonly record struct Outcome(ReadingCommandResultDto Result, bool DidChange)
    {
        public static Outcome Changed(ReadingCommandResultDto result) => new(result, true);
        public static Outcome Unchanged(ReadingCommandResultDto result) => new(result, false);
    }
}
