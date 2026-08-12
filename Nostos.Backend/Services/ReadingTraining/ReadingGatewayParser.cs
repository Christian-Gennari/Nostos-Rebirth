using System.Text.RegularExpressions;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

/// <summary>
/// Pure, deterministic classification of raw gateway text into a single
/// reading intent. This is the Nostos-owned mirror of the legacy coach's
/// canonical control vocabulary and capture classification; it never
/// consults state, EF, the filesystem, or any external runtime, and it never
/// alters the raw text it classifies.
///
/// Accepted canonical controls (matched case-insensitively on collapsed
/// whitespace; the raw text is never rewritten):
///   status       — "status", "what am i reading", "what am i currently
///                  reading", or any text containing "how long", "elapsed",
///                  "time left", "minutes left", "time remaining",
///                  "how much time", or "time so far"
///   start        — "start", "start now"
///   start new    — "start a new reading session", "start new",
///                  "start new session", "new session"
///   pause        — "pause", "pause reading"            (also "answer now",
///                  "answer now please" — pause authority, see dispatcher)
///   resume       — "resume", "resume reading"
///   done         — "done", "stop", "stop reading", "end", "end reading",
///                  "end session", "end reading session", or any text
///                  beginning with "done " (compact "done 42m", optionally
///                  "done 42m effort 4 focus 8" — effort/focus are parsed
///                  for recognition only and intentionally NOT applied: a
///                  gateway dispatch performs exactly one service mutation,
///                  ratings stay in the two-turn flow)
///   skip         — "skip ratings", "skip rating", "skip"
///   cancel       — "cancel", "cancel session", "abandon", "discard",
///                  "discard it", "abandon session"
///   rate pair    — "4, 8", "4; 8", or "rate 4 8" (effort, focus 1-10)
///
/// Everything else is either a raw capture candidate (thought/question/
/// bookmark, classified exactly like the legacy coach) or deliberately
/// ignored: slash commands, model-driven reading queries (weekly review,
/// week summary, inbox, queue add, finish book), and the legacy "read"
/// prescription (which has no argument-less Nostos equivalent and is routed
/// by the connector through the model/MCP instead).
/// </summary>
public static class ReadingGatewayParser
{
    /// <summary>Intent kinds a raw gateway message can produce.</summary>
    public enum ReadingGatewayIntentKind
    {
        /// <summary>Never acted on: no service call, no capture, no state.</summary>
        Ignored = 0,
        /// <summary>Read-only session status (GetStatusAsync).</summary>
        Status,
        /// <summary>Start the open planned session (StartSessionAsync).</summary>
        Start,
        /// <summary>Create and start a session (StartNewSessionAsync).</summary>
        StartNew,
        /// <summary>Pause the open session (PauseSessionAsync).</summary>
        Pause,
        /// <summary>Resume the open session (ResumeSessionAsync).</summary>
        Resume,
        /// <summary>Complete the open session (CompleteSessionAsync).</summary>
        Complete,
        /// <summary>Submit effort/focus ratings (RateSessionAsync).</summary>
        Rate,
        /// <summary>Close without ratings (SkipRatingsAsync).</summary>
        SkipRatings,
        /// <summary>Cancel the open session (CancelSessionAsync).</summary>
        Cancel,
        /// <summary>
        /// Raw capture candidate; the dispatcher decides from live session
        /// state whether the text is captured (active session, or a paused
        /// session with an explicit thought/question/bookmark prefix).
        /// </summary>
        Capture,
    }

    public sealed record ReadingGatewayIntent(
        ReadingGatewayIntentKind Kind,
        int? ReportedMinutes = null,
        int? Effort = null,
        int? Focus = null,
        ReadingCaptureType? CaptureType = null,
        bool ExplicitPrefix = false);

    // Recognition normalization: collapse whitespace, trim, lowercase. Used
    // ONLY for control matching; the captured text stays byte-for-byte raw.
    private static string Normalize(string text) =>
        string.IsNullOrWhiteSpace(text) ? string.Empty : Regex.Replace(text, @"\s+", " ").Trim().ToLowerInvariant();

    // --- canonical controls (exact vocabulary, order-sensitive) ---
    private static readonly HashSet<string> StatusForms = new(StringComparer.Ordinal)
    {
        "status", "what am i reading", "what am i currently reading",
    };
    private static readonly HashSet<string> StartForms = new(StringComparer.Ordinal)
    {
        "start", "start now",
    };
    private static readonly HashSet<string> StartNewForms = new(StringComparer.Ordinal)
    {
        "start a new reading session", "start new", "start new session", "new session",
    };
    private static readonly HashSet<string> PauseForms = new(StringComparer.Ordinal)
    {
        "pause", "pause reading",
    };
    private static readonly HashSet<string> ResumeForms = new(StringComparer.Ordinal)
    {
        "resume", "resume reading",
    };
    private static readonly HashSet<string> SkipRatingsForms = new(StringComparer.Ordinal)
    {
        "skip ratings", "skip rating", "skip",
    };
    private static readonly HashSet<string> CancelForms = new(StringComparer.Ordinal)
    {
        "cancel", "cancel session",
    };
    private static readonly HashSet<string> AbandonForms = new(StringComparer.Ordinal)
    {
        "abandon", "discard", "discard it", "abandon session",
    };
    private static readonly HashSet<string> AnswerNowForms = new(StringComparer.Ordinal)
    {
        "answer now", "answer now please",
    };
    private static readonly HashSet<string> DoneForms = new(StringComparer.Ordinal)
    {
        "done", "stop", "stop reading", "end", "end reading",
        "end session", "end reading session",
    };
    private static readonly HashSet<string> InboxForms = new(StringComparer.Ordinal)
    {
        "inbox", "reading inbox", "show inbox", "my inbox",
    };

    private static readonly Regex ElapsedQueryRegex = new(
        "(how long|elapsed|time left|minutes left|time remaining|how much time|time so far)",
        RegexOptions.Compiled);
    private static readonly Regex ReviewQueryRegex = new(
        "^weekly reading review$|^review$|^reading review$|review the week|weekly review",
        RegexOptions.Compiled);
    private static readonly Regex WeekQueryRegex = new(
        "how much (have|did) i read this week|this week's|this week",
        RegexOptions.Compiled);
    private static readonly Regex QueueAddRegex = new(
        "^add .* to the reading queue$|^add .* to my queue$|^add .* to the queue$",
        RegexOptions.Compiled);

    private static readonly Regex DoneMinutesRegex = new(
        @"\b(\d{1,4})\s*(?:m(?:in(?:ute)?s?)?)\b", RegexOptions.Compiled);
    private static readonly Regex DoneEffortRegex = new(
        @"\beffort\s*[:=]?\s*(\d{1,2})\b", RegexOptions.Compiled);
    private static readonly Regex DoneFocusRegex = new(
        @"\bfocus\s*[:=]?\s*(\d{1,2})\b", RegexOptions.Compiled);
    private static readonly Regex BareNumberRegex = new(
        @"\b(\d{1,4})\b", RegexOptions.Compiled);

    private static readonly Regex RatePairRegex = new(
        @"^\s*(\d{1,2})\s*[,;]\s*(\d{1,2})\s*$", RegexOptions.Compiled);
    private static readonly Regex RateWordsRegex = new(
        @"^rate\s+(\d{1,2})\s+(\d{1,2})\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    // --- capture classification (legacy-coach faithful) ---
    // The prefix must be followed by non-blank content; matching is
    // case-sensitive exactly like the legacy classifier (a loud "THOUGHT: x"
    // still classifies as a thought, but counts as an explicit prefix).
    private static readonly Regex CapturePrefixRegex = new(
        @"^\s*(thought|question|bookmark)\s*:\s*(.+)$",
        RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex QuestionWordsRegex = new(
        @"^(what|why|when|where|how|who|which|whom|whose|is|are|was|were|do|does|did|" +
        @"can|could|would|should|will|shall|may|might)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>
    /// Classify a raw gateway text into exactly one intent. Never throws for
    /// arbitrary input; the raw text is never modified.
    /// </summary>
    public static ReadingGatewayIntent Classify(string? text)
    {
        var raw = text ?? string.Empty;
        var norm = Normalize(raw);
        if (norm.Length == 0)
            return Ignored();

        // Slash commands are never reading input (defensive gate; the
        // connector owns transport-level filtering as well).
        if (norm[0] == '/')
            return Ignored();

        // Exact canonical controls.
        if (StatusForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Status);
        if (StartForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Start);
        if (StartNewForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.StartNew);
        if (PauseForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Pause);
        if (ResumeForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Resume);
        if (SkipRatingsForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.SkipRatings);
        if (CancelForms.Contains(norm) || AbandonForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Cancel);
        if (AnswerNowForms.Contains(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Pause);

        // "read" is the legacy prescription control; it has no argument-less
        // Nostos equivalent (planning needs an explicit book and mode), so it
        // is recognized and deliberately ignored — the connector routes it
        // through the model/MCP instead. Never captured as a thought.
        if (norm == "read")
            return Ignored();

        // Elapsed/remaining queries are status reads.
        if (ElapsedQueryRegex.IsMatch(norm))
            return new ReadingGatewayIntent(ReadingGatewayIntentKind.Status);

        // Done / stop / end compact forms (with optional compact args).
        if (DoneForms.Contains(norm) || norm.StartsWith("done ", StringComparison.Ordinal))
        {
            var (minutes, effort, focus) = ParseDoneArgs(norm);
            _ = (effort, focus); // parsed for recognition only; never applied
            return new ReadingGatewayIntent(
                ReadingGatewayIntentKind.Complete, ReportedMinutes: minutes);
        }

        // Ratings pair while awaiting feedback ("4, 8", "4; 8", "rate 4 8").
        var rate = ParseRatePair(raw);
        if (rate is not null)
            return new ReadingGatewayIntent(
                ReadingGatewayIntentKind.Rate, Effort: rate.Value.Effort, Focus: rate.Value.Focus);

        // Model-driven reading-domain queries are recognized so they are
        // NEVER captured as thoughts; the connector lets the model handle
        // them through the MCP surface.
        if (ReviewQueryRegex.IsMatch(norm))
            return Ignored();
        if (WeekQueryRegex.IsMatch(norm))
            return Ignored();
        if (InboxForms.Contains(norm))
            return Ignored();
        if (QueueAddRegex.IsMatch(norm))
            return Ignored();
        if (norm.StartsWith("finished ", StringComparison.Ordinal) ||
            norm.StartsWith("finish ", StringComparison.Ordinal))
            return Ignored();

        // Raw capture candidate with the legacy classification:
        // explicit prefix wins, then trailing/interrogative questions,
        // then thoughts.
        var trimmed = raw.Trim();
        var prefix = CapturePrefixRegex.Match(trimmed);
        if (prefix.Success)
        {
            var type = prefix.Groups[1].Value switch
            {
                "question" => ReadingCaptureType.Question,
                "bookmark" => ReadingCaptureType.Bookmark,
                _ => ReadingCaptureType.Thought,
            };
            return new ReadingGatewayIntent(
                ReadingGatewayIntentKind.Capture, CaptureType: type, ExplicitPrefix: true);
        }

        var explicitPrefix = norm.StartsWith("thought:", StringComparison.Ordinal) ||
                             norm.StartsWith("question:", StringComparison.Ordinal) ||
                             norm.StartsWith("bookmark:", StringComparison.Ordinal);
        var type2 = trimmed.EndsWith('?') || QuestionWordsRegex.IsMatch(trimmed)
            ? ReadingCaptureType.Question
            : ReadingCaptureType.Thought;
        return new ReadingGatewayIntent(
            ReadingGatewayIntentKind.Capture, CaptureType: type2, ExplicitPrefix: explicitPrefix);
    }

    private static (int? Minutes, int? Effort, int? Focus) ParseDoneArgs(string norm)
    {
        int? minutes = null, effort = null, focus = null;

        var mMin = DoneMinutesRegex.Match(norm);
        if (mMin.Success) minutes = int.Parse(mMin.Groups[1].Value);
        var mEff = DoneEffortRegex.Match(norm);
        if (mEff.Success) effort = int.Parse(mEff.Groups[1].Value);
        var mFoc = DoneFocusRegex.Match(norm);
        if (mFoc.Success) focus = int.Parse(mFoc.Groups[1].Value);

        if (minutes is null && effort is null && focus is null)
        {
            // A single bare number is minutes ("done 42").
            var bare = BareNumberRegex.Matches(norm);
            if (bare.Count == 1) minutes = int.Parse(bare[0].Groups[1].Value);
        }
        else if (minutes is null && (effort is not null || focus is not null))
        {
            // "done 42 effort 4 focus 8": the bare number before "effort".
            var before = norm.Split("effort", 2)[0];
            var bare = BareNumberRegex.Matches(before);
            if (bare.Count == 1) minutes = int.Parse(bare[0].Groups[1].Value);
        }

        if (minutes is { } m && (m < 1 || m > 999)) minutes = null;
        if (effort is { } e && (e < 1 || e > 10)) effort = null;
        if (focus is { } f && (f < 1 || f > 10)) focus = null;
        return (minutes, effort, focus);
    }

    private static (int Effort, int Focus)? ParseRatePair(string raw)
    {
        var m = RatePairRegex.Match(raw);
        if (!m.Success) m = RateWordsRegex.Match(raw);
        if (!m.Success) return null;
        var effort = int.Parse(m.Groups[1].Value);
        var focus = int.Parse(m.Groups[2].Value);
        return effort is >= 1 and <= 10 && focus is >= 1 and <= 10
            ? (effort, focus)
            : null;
    }

    private static ReadingGatewayIntent Ignored() =>
        new(ReadingGatewayIntentKind.Ignored);
}
