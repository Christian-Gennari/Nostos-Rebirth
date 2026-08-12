using FluentAssertions;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Parser matrix derived from the legacy reading-coach source oracle
// (reading_coach/parse.py classify_control + classify_capture): every
// accepted canonical control variant, case/outer-whitespace tolerance,
// slash-command ignore, model-driven-query ignore, unknown/no-active
// capture behavior, verbatim raw text, and capture classification.
public sealed class ReadingGatewayParserTests
{
    private static ReadingGatewayParser.ReadingGatewayIntent Intent(string text) =>
        ReadingGatewayParser.Classify(text);

    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Status =
        ReadingGatewayParser.ReadingGatewayIntentKind.Status;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Start =
        ReadingGatewayParser.ReadingGatewayIntentKind.Start;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind StartNew =
        ReadingGatewayParser.ReadingGatewayIntentKind.StartNew;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Pause =
        ReadingGatewayParser.ReadingGatewayIntentKind.Pause;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Resume =
        ReadingGatewayParser.ReadingGatewayIntentKind.Resume;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Complete =
        ReadingGatewayParser.ReadingGatewayIntentKind.Complete;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Rate =
        ReadingGatewayParser.ReadingGatewayIntentKind.Rate;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind SkipRatings =
        ReadingGatewayParser.ReadingGatewayIntentKind.SkipRatings;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Cancel =
        ReadingGatewayParser.ReadingGatewayIntentKind.Cancel;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Capture =
        ReadingGatewayParser.ReadingGatewayIntentKind.Capture;
    private static readonly ReadingGatewayParser.ReadingGatewayIntentKind Ignored =
        ReadingGatewayParser.ReadingGatewayIntentKind.Ignored;

    public static TheoryData<string, ReadingGatewayParser.ReadingGatewayIntentKind> AcceptedControls => new()
    {
        // --- status ---
        { "status", Status },
        { "what am i reading", Status },
        { "what am i currently reading", Status },
        // elapsed / remaining queries
        { "how long have i been reading", Status },
        { "elapsed", Status },
        { "time left", Status },
        { "minutes left", Status },
        { "time remaining", Status },
        { "how much time is left", Status },
        { "time so far", Status },
        // --- start ---
        { "start", Start },
        { "start now", Start },
        // --- start new ---
        { "start a new reading session", StartNew },
        { "start new", StartNew },
        { "start new session", StartNew },
        { "new session", StartNew },
        // --- pause / resume ---
        { "pause", Pause },
        { "pause reading", Pause },
        { "resume", Resume },
        { "resume reading", Resume },
        // --- skip ratings ---
        { "skip ratings", SkipRatings },
        { "skip rating", SkipRatings },
        { "skip", SkipRatings },
        // --- cancel / abandon ---
        { "cancel", Cancel },
        { "cancel session", Cancel },
        { "abandon", Cancel },
        { "discard", Cancel },
        { "discard it", Cancel },
        { "abandon session", Cancel },
        // --- answer now (authoritative pause) ---
        { "answer now", Pause },
        { "answer now please", Pause },
        // --- done / stop / end ---
        { "done", Complete },
        { "stop", Complete },
        { "stop reading", Complete },
        { "end", Complete },
        { "end reading", Complete },
        { "end session", Complete },
        { "end reading session", Complete },
        // --- rate pairs ---
        { "4, 8", Rate },
        { "4; 8", Rate },
        { "rate 4 8", Rate },
        { "RATE 4 8", Rate },
        { " 9 , 10 ", Rate },
        // --- case / outer-whitespace tolerance for recognition ---
        { "  PAUSE  ", Pause },
        { "\tpause\n", Pause },
        { "  Start  Now  ", Start },
        { "Pause Reading", Pause },
        { "DONE", Complete },
        { "ANSWER NOW", Pause },
    };

    [Theory]
    [MemberData(nameof(AcceptedControls))]
    public void Classify_RecognizesAcceptedControl(string text, ReadingGatewayParser.ReadingGatewayIntentKind kind)
    {
        Intent(text).Kind.Should().Be(kind, $"'{text}' should classify as {kind}");
    }

    public static TheoryData<string, int?> DoneMinutesCases => new()
    {
        { "done 42m", 42 },
        { "done 42 min", 42 },
        { "done 42 minutes", 42 },
        { "done 42", 42 },
        { "done 42m effort 4 focus 8", 42 },
        { "done 42 effort 4 focus 8", 42 },
        { "done 0m", null },   // invalid minutes are dropped, not rejected
        { "done", null },
        { "done 1m effort 11 focus 0", 1 }, // out-of-range ratings dropped independently
        { "done reading", null },
    };

    [Theory]
    [MemberData(nameof(DoneMinutesCases))]
    public void Classify_DoneCarriesOnlyReportedMinutes_AsSingleMutation(string text, int? minutes)
    {
        var intent = Intent(text);
        intent.Kind.Should().Be(Complete);
        intent.ReportedMinutes.Should().Be(minutes);
        // Compact effort/focus are parsed for recognition only and never
        // applied: a dispatch performs exactly one service mutation and the
        // two-turn ratings flow stays authoritative.
        intent.Effort.Should().BeNull();
        intent.Focus.Should().BeNull();
    }

    public static TheoryData<string, int, int> RateCases => new()
    {
        { "4, 8", 4, 8 },
        { "4; 8", 4, 8 },
        { "rate 4 8", 4, 8 },
        { "rate 10 1", 10, 1 },
        { "  7,  3  ", 7, 3 },
    };

    [Theory]
    [MemberData(nameof(RateCases))]
    public void Classify_RatePairCarriesEffortAndFocus(string text, int effort, int focus)
    {
        var intent = Intent(text);
        intent.Kind.Should().Be(Rate);
        intent.Effort.Should().Be(effort);
        intent.Focus.Should().Be(focus);
    }

    public static TheoryData<string> NeverCapturedCases => new()
    {
        // slash commands are never reading input
        { "/pause" },
        { "/read" },
        { "/start session" },
        { "/anything" },
        { "/" },
        // blank / whitespace-only
        { "" },
        { "   " },
        { "\t\n" },
        // legacy "read" prescription has no argument-less Nostos equivalent
        { "read" },
        { "  READ  " },
        // model-driven reading queries are recognized so they are never
        // captured as thoughts
        { "weekly reading review" },
        { "review" },
        { "reading review" },
        { "review the week" },
        { "weekly review" },
        { "how much did i read this week" },
        { "how much have i read this week" },
        { "this week's reading" },
        { "this week" },
        { "inbox" },
        { "reading inbox" },
        { "show inbox" },
        { "my inbox" },
        { "add candide to the reading queue" },
        { "add notes to my queue" },
        { "add a book to the queue" },
        { "finished candide" },
        { "finish candide" },
    };

    [Theory]
    [MemberData(nameof(NeverCapturedCases))]
    public void Classify_NeverCapturedInputsAreIgnored(string text)
    {
        Intent(text).Kind.Should().Be(Ignored, $"'{text}' must never become a capture");
    }

    public static TheoryData<string, ReadingCaptureType> CaptureTypeCases => new()
    {
        // explicit prefixes win (legacy prefix regex is case-sensitive)
        { "thought: this is a thought", ReadingCaptureType.Thought },
        { "question: what is the answer?", ReadingCaptureType.Question },
        { "bookmark: page 12", ReadingCaptureType.Bookmark },
        { "  thought:  spaced content  ", ReadingCaptureType.Thought },
        // trailing question mark
        { "what is this?", ReadingCaptureType.Question },
        { "is this right?", ReadingCaptureType.Question },
        // interrogative starting word, with or without a question mark
        { "Why did the author write this", ReadingCaptureType.Question },
        { "Is this correct", ReadingCaptureType.Question },
        { "How does this work?", ReadingCaptureType.Question },
        // everything else is a thought (v1 capture policy)
        { "a passing thought", ReadingCaptureType.Thought },
        { "the book was good", ReadingCaptureType.Thought },
        { "I should reread this section", ReadingCaptureType.Thought },
        // loud prefix: still a thought, but counts as an explicit prefix
        { "THOUGHT: loud", ReadingCaptureType.Thought },
        { "thought:", ReadingCaptureType.Thought },
    };

    [Theory]
    [MemberData(nameof(CaptureTypeCases))]
    public void Classify_ClassifiesCaptureTypes(string text, ReadingCaptureType type)
    {
        var intent = Intent(text);
        intent.Kind.Should().Be(Capture);
        intent.CaptureType.Should().Be(type);
    }

    public static TheoryData<string> ExplicitPrefixCases => new()
    {
        { "thought: this is a thought" },
        { "question: what is the answer?" },
        { "bookmark: page 12" },
        { "  thought:  spaced content  " },
        { "THOUGHT: loud" },
    };

    [Theory]
    [MemberData(nameof(ExplicitPrefixCases))]
    public void Classify_MarksExplicitCapturePrefixes(string text)
    {
        var intent = Intent(text);
        intent.Kind.Should().Be(Capture);
        intent.ExplicitPrefix.Should().BeTrue($"'{text}' carries an explicit capture prefix");
    }

    [Theory]
    [InlineData("a passing thought")]
    [InlineData("what is this?")]
    [InlineData("I should reread this section")]
    public void Classify_OrdinaryTextIsNotAnExplicitPrefix(string text)
    {
        Intent(text).ExplicitPrefix.Should().BeFalse();
    }

    [Fact]
    public void Classify_NeverMutatesTheRawText()
    {
        // The parser only trims/case-folds a private normalized copy for
        // recognition; the captured text must remain byte-for-byte raw.
        const string raw = "  A Thought  With   Odd   Spacing  ";
        var intent = Intent(raw);
        intent.Kind.Should().Be(Capture);
        intent.CaptureType.Should().Be(ReadingCaptureType.Thought);
    }
}
