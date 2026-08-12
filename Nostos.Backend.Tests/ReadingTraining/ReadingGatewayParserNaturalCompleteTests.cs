using FluentAssertions;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

/// <summary>
/// Issue #32: conversational session-end phrasing must classify as Complete
/// (never Capture). The grammar is full-message anchored — interpretive
/// thoughts containing "end"/"done" stay capture candidates, explicit
/// prefixes always win, and every existing exact form keeps its behavior.
/// </summary>
public sealed class ReadingGatewayParserNaturalCompleteTests
{
    private static ReadingGatewayParser.ReadingGatewayIntent Classify(string text) =>
        ReadingGatewayParser.Classify(text);

    // --- the incident ---

    [Fact]
    public void Classify_IncidentPhrase_ReturnsCompleteWithReportedMinutes()
    {
        var intent = Classify("Ok end this round, I actually maybe read 20 minutes max.");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(20);
        intent.Natural.Should().BeTrue();
    }

    [Fact]
    public void Classify_EndThisRoundWithoutMinutes_ReturnsComplete()
    {
        var intent = Classify("end this round");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().BeNull();
        intent.Natural.Should().BeTrue();
    }

    [Fact]
    public void Classify_EndSessionWithCompactMinutes_ReturnsCompleteWithMinutes()
    {
        var intent = Classify("end this session 20m");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(20);
    }

    [Fact]
    public void Classify_DoneForTodayWithApproximateMinutes_ReturnsCompleteWithMinutes()
    {
        var intent = Classify("well done for today maybe 25 minutes");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(25);
    }

    [Fact]
    public void Classify_SwedishCompletionWithMinutes_ReturnsCompleteWithMinutes()
    {
        var intent = Classify("okej avsluta sessionen jag läste kanske 20 minuter");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(20);
    }

    [Fact]
    public void Classify_SwedishKlarWithApproximateMinutes_ReturnsCompleteWithMinutes()
    {
        var intent = Classify("jag tror jag är klar ungefär 25 min");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(25);
    }

    [Fact]
    public void Classify_BareMinutesAfterPhrase_ReturnsCompleteWithMinutes()
    {
        var intent = Classify("end this round 20");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(20);
    }

    // --- English phrase families ---

    [Theory]
    [InlineData("end this round")]
    [InlineData("end the round")]
    [InlineData("end this session")]
    [InlineData("end the session")]
    [InlineData("end my session")]
    [InlineData("end this reading session")]
    [InlineData("end reading")]
    [InlineData("finish this session")]
    [InlineData("finish the round")]
    [InlineData("finish reading")]
    [InlineData("i'm done")]
    [InlineData("im done")]
    [InlineData("i am done")]
    [InlineData("we're done")]
    [InlineData("done for now")]
    [InlineData("done for today")]
    [InlineData("done with this session")]
    [InlineData("done with reading")]
    [InlineData("that's it")]
    [InlineData("thats all")]
    [InlineData("stop here")]
    [InlineData("stopping here")]
    [InlineData("wrap up")]
    [InlineData("wrapping up")]
    [InlineData("call it")]
    [InlineData("call it for tonight")]
    [InlineData("call it a day")]
    [InlineData("ok end")]
    [InlineData("so done")]
    public void Classify_EnglishCompletionPhrase_ReturnsComplete(string phrase)
    {
        var intent = Classify(phrase);

        // Some families ("done for today", "end reading") are already owned
        // by the exact forms; both paths must land on Complete.
        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
    }

    // --- Swedish phrase families ---

    [Theory]
    [InlineData("avsluta")]
    [InlineData("avslutar")]
    [InlineData("avsluta rundan")]
    [InlineData("avsluta den här rundan")]
    [InlineData("avsluta sessionen")]
    [InlineData("avsluta den här sessionen")]
    [InlineData("avsluta läsningen")]
    [InlineData("avslutar läspasset")]
    [InlineData("jag är klar")]
    [InlineData("jag är färdig")]
    [InlineData("vi är klara")]
    [InlineData("vi är färdiga")]
    [InlineData("klar")]
    [InlineData("klar nu")]
    [InlineData("klar för idag")]
    [InlineData("färdig för ikväll")]
    [InlineData("slut")]
    [InlineData("slut för idag")]
    [InlineData("slut för ikväll")]
    [InlineData("det är allt")]
    [InlineData("det var allt")]
    [InlineData("jag stannar här")]
    [InlineData("stannar här")]
    [InlineData("runda av")]
    [InlineData("rundar av")]
    [InlineData("avrunda")]
    [InlineData("sluta")]
    [InlineData("sluta läsa")]
    public void Classify_SwedishCompletionPhrase_ReturnsComplete(string phrase)
    {
        var intent = Classify(phrase);

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
    }

    // --- filler and transcription tolerance ---

    [Fact]
    public void Classify_RepeatedEnglishFillersBeforeCompletion_ReturnsComplete()
    {
        var intent = Classify("ok well i think i'm done");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
    }

    [Fact]
    public void Classify_RepeatedSwedishFillersBeforeCompletion_ReturnsComplete()
    {
        var intent = Classify("okej alltså jag tror jag är klar");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
    }

    [Fact]
    public void Classify_CompletionIsCaseAndPunctuationInsensitive()
    {
        var intent = Classify("OK—END THIS ROUND!");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
    }

    [Fact]
    public void Classify_CurlyApostropheCompletion_ReturnsComplete()
    {
        var intent = Classify("I’m done.");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
    }

    // --- long-thought protection: end/done inside genuine prose ---

    [Theory]
    [InlineData("The ending of The Garden of Forking Paths forces us to reread the beginning.")]
    [InlineData("At the end of the chapter Aristotle changes the question.")]
    [InlineData("I'm done with this chapter — the symmetry is the point.")]
    [InlineData("That's it, the symmetry explains the ending.")]
    [InlineData("End this round and the ending finally makes sense.")]
    [InlineData("End this round, 20 or maybe 30 minutes.")]
    [InlineData("Jag är klar med boken men slutet känns påtvingat.")]
    [InlineData("The weekend reading was beautiful.")]
    public void Classify_InterpretiveThoughtContainingEndWords_RemainsCapture(string text)
    {
        var intent = Classify(text);

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Capture);
        intent.Natural.Should().BeFalse();
    }

    // --- explicit-prefix override ---

    [Theory]
    [InlineData("thought: I'm done with this chapter — the symmetry is the point", ReadingCaptureType.Thought)]
    [InlineData("question: are we done with this argument?", ReadingCaptureType.Question)]
    [InlineData("bookmark: end this round", ReadingCaptureType.Bookmark)]
    public void Classify_ExplicitPrefixOverridesNaturalCompletion(string text, ReadingCaptureType type)
    {
        var intent = Classify(text);

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Capture);
        intent.ExplicitPrefix.Should().BeTrue();
        intent.CaptureType.Should().Be(type);
    }

    // --- precedence and regressions ---

    [Fact]
    public void Classify_RatingPairWithCompletionLanguage_PreservesRatePrecedence()
    {
        var intent = Classify("4, 8");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Rate);
    }

    [Fact]
    public void Classify_ExistingDoneForm_RemainsComplete()
    {
        var intent = Classify("done");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.Natural.Should().BeFalse(); // exact form, not the new grammar
    }

    [Fact]
    public void Classify_ExistingEndForm_RemainsComplete()
    {
        var intent = Classify("end");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.Natural.Should().BeFalse();
    }

    [Fact]
    public void Classify_ExistingDoneMinutesForm_RetainsReportedMinutes()
    {
        var intent = Classify("done 25 min");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Complete);
        intent.ReportedMinutes.Should().Be(25);
    }

    [Fact]
    public void Classify_ExistingElapsedQuery_RemainsStatus()
    {
        var intent = Classify("how long have I been reading");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Status);
    }

    [Fact]
    public void Classify_ExistingQueueAdd_RemainsIgnored()
    {
        var intent = Classify("add candide to the reading queue");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Ignored);
    }

    [Fact]
    public void Classify_GenericStopPhrase_IsNotPromotedToComplete()
    {
        // "stop for a bit" is ambiguous (pause vs complete) and stays a
        // capture candidate — only the listed completion phrases promote.
        var intent = Classify("stop for a bit");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Capture);
    }

    [Fact]
    public void Classify_EndingWord_IsNotTreatedAsEndControl()
    {
        var intent = Classify("ending");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Capture);
    }

    [Fact]
    public void Classify_FinishWithNonCompletionObject_StaysIgnored()
    {
        // "finish the essay draft" is not completion phrasing; the legacy
        // model-query ignore still applies and it is never captured.
        var intent = Classify("finish the essay draft");

        intent.Kind.Should().Be(ReadingGatewayParser.ReadingGatewayIntentKind.Ignored);
    }
}
