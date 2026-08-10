using System.Globalization;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

// Canonical reply vocabulary. Strings mirror the accepted behaviours of the
// Python reading coach (the behaviour oracle); the v1 parity contract pins the
// exact rating prompt "Effort 1–10?\nFocus 1–10?" and the reply vocabulary is
// free of streak/debt/catch-up/guilt/compulsory language.
public static class ReadingReplyFormatter
{
    // --- programme initialization ---
    public const string InitializedFresh =
        "Reading training initialized: endurance 40 min, deep 30 min, recovery 20 min.";
    public const string AlreadyInitialized = "Reading training already initialized.";

    // --- status ---
    public const string NoActiveSession = "No active reading session.";

    public static string StatusPlanned(string mode, int targetMinutes, string book) =>
        $"Planned: {mode} {targetMinutes} min with {book}. Reply 'start' when ready.";

    public static string StatusPaused(string book, int minutes) =>
        $"Paused — {book}, {minutes} min so far. Reply 'resume' to continue.";

    public static string StatusActive(string book, string mode, int minutes, int remaining) =>
        $"Reading {book} — {mode}, {minutes} min in, {remaining} min to target. Reply 'done' when finished.";

    public static string StatusAwaitingFeedback(int effectiveMinutes) =>
        $"Session done — {effectiveMinutes} min logged. How did it go? Effort and focus (1\u201310), or 'skip ratings'.";

    // --- prescription / plan ---
    public const string UnknownMode = "Unknown mode — choose endurance, deep, or recovery.";

    public static string NoActiveBook(string mode) =>
        $"No active {(mode == "deep" ? "deep-reading" : "endurance")} book. Tell me which book you want to use.";

    public static string Plan(string modeWord, int targetMinutes, string book, bool constrained) =>
        $"{modeWord} — {targetMinutes} min\n{book}\n\n" +
        (constrained
            ? "That's today's available load."
            : "Keep moving through the text. Save tangents for afterward.") +
        "\n\nSay \"start\" when you begin.";

    // --- start ---
    public static string Start(string book, string modeUpper, int targetMinutes, string startedTime) =>
        $"{book}\n{modeUpper}\nTarget: {targetMinutes} min\nStarted: {startedTime}";

    // --- pause / resume / cancel ---
    public const string NoSessionToPause = "No active session to pause.";
    public const string AlreadyPaused = "Already paused.";
    public const string NotStartedToPause = "This session hasn't started yet — nothing to pause.";
    public const string FinishedRateOrSkip = "This session is finished — rate it or skip ratings.";

    public static string Paused(int minutes) =>
        $"Paused — {minutes} min so far. Say 'resume' to continue.";

    public const string NoSessionToResume = "No session to resume.";
    public const string NothingToResume = "Nothing to resume — the session is not paused.";

    public static string Resumed(string book) =>
        $"Resumed: {book}. Reply 'done' when finished.";

    public const string NoSessionToCancel = "No active session to cancel.";
    public const string Cancelled = "Session cancelled. It won't count toward your training.";

    // --- complete / rate / skip ---
    public const string NoActiveSessionToComplete = "No active session — plan one or say 'start' first.";
    public const string NotStartedToComplete = "This session hasn't started — say 'start' to begin, or 'cancel'.";

    public static string StaleActive(string book) =>
        $"{book} is still marked active from earlier. How many minutes did you actually read, or should I discard it?";

    public const string StaleAwaiting =
        "It's been a while — did you actually finish? Reply 'actual <minutes>' or 'discard'.";

    public static string LoggedActualMinutes(int minutes) =>
        $"Logged {minutes} min for that session.";

    public const string AlreadyLogged = "That session is already logged.";
    public const string AlreadyLoggedHowDidItGo =
        "Your session was already logged. How did it go? Effort and focus (1\u201310), or 'skip ratings'.";

    // Exact parity text pinned by the v1 contract.
    public const string RatePrompt = "Effort 1–10?\nFocus 1–10?";

    public static string LoggedWithRatings(int minutes, int effort, int focus, int plannedTarget) =>
        $"Logged. {minutes} min · effort {effort} · focus {focus}.\nStay at {plannedTarget} minutes for now.";

    public const string NoRatingsPending = "No ratings pending — finish a session first.";
    public const string GiveRatings = "Give effort and focus as 1–10, or 'skip ratings'.";
    public const string RatingsAlreadyLogged = "Ratings were already logged.";

    public static string LoggedRating(string book, int minutes, int effort, int focus) =>
        $"Logged: {book}, {minutes} min.\nEffort {effort}/10 · Focus {focus}/10.";

    public const string NoRatingsPendingSkip = "No ratings pending.";
    public const string RatingsAlreadySkipped = "Ratings were already skipped.";
    public const string RatingsSkipped = "Ratings skipped — session closed.";

    // --- captures / inbox ---
    public const string NothingToCapture = "Nothing to capture.";
    public const string AlreadyCaptured = "Already captured.";
    public const string NoActiveBookToAttach = "No active book to attach this capture to.";
    public const string ThoughtCaptured = "Thought captured.";
    public const string QuestionAdded =
        "Question added to your inbox — say 'answer now' when you want to answer it.";
    public const string BookmarkAdded = "Bookmark added to your inbox.";
    public const string InboxEmpty = "Inbox empty.";

    public static string InboxCount(int count) =>
        $"{count} unresolved item(s).";

    public const string CaptureNotFound = "Capture not found.";
    public const string NoteNotFound = "Note not found.";
    public const string AlreadyDisposed = "That item was already disposed.";

    public static string Disposed(int count, string disposition) =>
        $"{count} item(s) marked {disposition}.";

    // --- books / queue ---
    public const string BookNotFound = "Book not found.";
    public const string NoMatchingBook = "No matching book in the queue.";

    public static string AlreadyInQueue(string title) =>
        $"{title} is already in the queue.";

    public static string AddedToQueue(string title) =>
        $"{title} added to the reading queue.";

    public static string NotAssignedToMode(string title, string mode) =>
        $"{title} isn't assigned to {mode}.";

    public static string AlreadyFinished(string title) =>
        $"{title} was already finished.";

    public static string MarkedFinished(string title) =>
        $"{title} marked finished.";

    public static string SetDefault(string title, string mode) =>
        $"{title} is now the default {mode} book.";

    public const string Reordered = "Queue reordered.";
    public const string NothingToReorder = "Nothing to reorder.";
    public const string SessionNotOpen = "That session isn't open.";

    // --- snapshots ---
    public const string Dashboard = "Dashboard.";
    public const string Status = "Status.";

    public static string History(int count) =>
        $"History: {count} session(s).";

    public static string Queue(int count) =>
        $"Queue: {count} assignment(s).";

    // --- weekly review ---
    public static string InvalidWeek(int year, int week) =>
        $"Week {year}-W{week:00} is not a valid ISO week.";

    public static string WeekPreview(string weekKey, IReadOnlyList<ReadingProgressionResult> results) =>
        $"Week {weekKey} preview — {WeekModesSummary(results)}.";

    public static string WeekCommitted(string weekKey, IReadOnlyList<ReadingProgressionResult> results) =>
        $"Week {weekKey} committed — {WeekModesSummary(results)}.";

    public static string WeekAlreadyCommitted(string weekKey) =>
        $"Week {weekKey} was already reviewed.";

    private static string WeekModesSummary(IReadOnlyList<ReadingProgressionResult> results) =>
        string.Join(" · ", results.Select(r => $"{ModeLabel(r.Mode)} {r.TargetBeforeMinutes}→{r.TargetAfterMinutes}"));

    // --- mode words ---
    public static string ModeWord(ReadingMode mode) => mode switch
    {
        ReadingMode.Endurance => "Endurance",
        ReadingMode.Deep => "Deep",
        ReadingMode.Recovery => "Recovery",
        _ => "Endurance",
    };

    // Lowercase mode label used in prose replies, matching the oracle.
    public static string ModeLabel(ReadingMode mode) => mode switch
    {
        ReadingMode.Deep => "deep",
        ReadingMode.Recovery => "recovery",
        _ => "endurance",
    };

    public static string ModeUpper(ReadingMode mode) => ModeWord(mode).ToUpperInvariant();

    public static string StartTime(DateTime localNow) =>
        localNow.ToString("HH:mm", CultureInfo.InvariantCulture);
}
