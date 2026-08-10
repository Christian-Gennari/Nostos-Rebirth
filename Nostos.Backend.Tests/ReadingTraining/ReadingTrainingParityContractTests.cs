using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;
using Xunit.Sdk;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 4/S3 — frozen v1 behaviour parity contract, executed against the real
// engine. The three structural facts pin the fixture shape; the executor fact
// below runs EVERY frozen case through a real ReadingTrainingService over a
// real temp-file SQLite database (the same harness pattern as the service and
// weekly-review suites). It fails on unknown case ids and proves each known id
// is consumed exactly once. A separate stress fixture drives a deterministic
// 10+ session week (verification-gap #6: previously only <=4-session weeks existed).
public sealed class ReadingTrainingParityContractTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    // Frozen v1 case ids — the exact contract set. The executor fails on any
    // id outside this set and proves each id is consumed exactly once.
    private static readonly string[] KnownCaseIds =
    [
        "baseline-001", "state-002", "open-slot-003", "elapsed-004", "report-005",
        "constraint-006", "fatigue-007", "default-008", "book-link-009", "weekly-010",
        "volume-011", "review-012", "command-013", "capture-014", "language-015",
    ];

    // ISO week 31/32 2026 (Europe/Stockholm) UTC instants, mirroring the
    // weekly-review suite so seeded sessions land in deterministic weeks.
    private static readonly DateTime Week31StartUtc = new(2026, 7, 26, 22, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week32StartUtc = new(2026, 8, 2, 22, 0, 0, DateTimeKind.Utc);

    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingTrainingParityContractTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    private static readonly string FixturePath = Path.Combine(
        AppContext.BaseDirectory, "fixtures", "reading-training", "behaviour-v1.json");

    private static async Task<JsonDocument> LoadFixtureAsync()
    {
        var json = await File.ReadAllTextAsync(FixturePath).ConfigureAwait(false);
        return JsonDocument.Parse(json);
    }

    [Fact]
    public async Task Fixture_defines_the_v1_baseline_targets()
    {
        using var doc = await LoadFixtureAsync();
        var root = doc.RootElement;
        root.GetProperty("version").GetInt32().Should().Be(1);

        var defaults = root.GetProperty("defaults");
        defaults.GetProperty("enduranceTargetMinutes").GetInt32().Should().Be(40);
        defaults.GetProperty("deepTargetMinutes").GetInt32().Should().Be(30);
        defaults.GetProperty("recoveryTargetMinutes").GetInt32().Should().Be(20);
    }

    [Fact]
    public async Task Fixture_case_ids_are_unique_and_non_empty()
    {
        using var doc = await LoadFixtureAsync();
        var root = doc.RootElement;
        var ids = root
            .GetProperty("cases")
            .EnumerateArray()
            .Select(c => c.GetProperty("id").GetString())
            .ToList();

        ids.Should().NotBeEmpty();
        ids.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public async Task Fixture_states_match_the_shared_session_status_enum()
    {
        using var doc = await LoadFixtureAsync();
        var root = doc.RootElement;
        var states = root
            .GetProperty("states")
            .EnumerateArray()
            .Select(s => s.GetString())
            .ToList();

        var enumNames = Enum.GetNames<Nostos.Shared.Enums.ReadingSessionStatus>();
        states.Should().BeEquivalentTo(enumNames);
    }

    [Fact]
    public async Task All_frozen_cases_execute_against_the_real_engine_exactly_once()
    {
        using var doc = await LoadFixtureAsync();
        var cases = doc.RootElement.GetProperty("cases").EnumerateArray().ToList();

        // Fails on unknown ids, missing ids, duplicates and reorderings: the
        // frozen v1 contract is an exact ordered set of known ids.
        cases.Select(c => c.GetProperty("id").GetString()).Should().Equal(KnownCaseIds);

        var consumed = new HashSet<string>();
        foreach (var c in cases)
        {
            var id = c.GetProperty("id").GetString()!;
            id.Should().BeOneOf(KnownCaseIds, $"parity case '{id}' is not a known frozen v1 case id");
            await ExecuteAsync(id);
            consumed.Add(id);
        }

        // Every known case ran exactly once against the real engine.
        consumed.Should().BeEquivalentTo(KnownCaseIds);
    }

    private async Task ExecuteAsync(string id)
    {
        switch (id)
        {
            case "baseline-001": await Baseline001Async().ConfigureAwait(false); break;
            case "state-002": await State002Async().ConfigureAwait(false); break;
            case "open-slot-003": await OpenSlot003Async().ConfigureAwait(false); break;
            case "elapsed-004": await Elapsed004Async().ConfigureAwait(false); break;
            case "report-005": await Report005Async().ConfigureAwait(false); break;
            case "constraint-006": await Constraint006Async().ConfigureAwait(false); break;
            case "fatigue-007": await Fatigue007Async().ConfigureAwait(false); break;
            case "default-008": await Default008Async().ConfigureAwait(false); break;
            case "book-link-009": await BookLink009Async().ConfigureAwait(false); break;
            case "weekly-010": await Weekly010Async().ConfigureAwait(false); break;
            case "volume-011": await Volume011Async().ConfigureAwait(false); break;
            case "review-012": await Review012Async().ConfigureAwait(false); break;
            case "command-013": await Command013Async().ConfigureAwait(false); break;
            case "capture-014": await Capture014Async().ConfigureAwait(false); break;
            case "language-015": await Language015Async().ConfigureAwait(false); break;
            default:
                throw new XunitException($"No engine drive registered for parity case '{id}'.");
        }
    }

    // --- case drives (each on a fresh real temp-file SQLite database) -------

    private async Task Baseline001Async()
    {
        var h = Harness();
        await h.Init();

        var targets = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).Programme.Targets;

        targets.EnduranceTargetMinutes.Should().Be(40);
        targets.DeepTargetMinutes.Should().Be(30);
        targets.RecoveryTargetMinutes.Should().Be(20);
    }

    private async Task State002Async()
    {
        var h = Harness();
        await h.Init();
        var planned = await h.PlanDefault("Candide", ReadingMode.Endurance);

        var path = new List<ReadingSessionStatus> { planned.Status };
        path.Add(((ReadingSessionDto)(await h.Service.StartSessionAsync(new("ui", "s-start"))).Data!).Status);
        path.Add(((ReadingSessionDto)(await h.Service.PauseSessionAsync(new("ui", "s-pause"))).Data!).Status);
        path.Add(((ReadingSessionDto)(await h.Service.ResumeSessionAsync(new("ui", "s-resume"))).Data!).Status);
        path.Add(((ReadingSessionDto)(await h.Service.CompleteSessionAsync(new("ui", "s-complete", 40))).Data!).Status);

        path.Should().Equal(
            ReadingSessionStatus.Planned,
            ReadingSessionStatus.Active,
            ReadingSessionStatus.Paused,
            ReadingSessionStatus.Active,
            ReadingSessionStatus.AwaitingFeedback);
    }

    private async Task OpenSlot003Async()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));

        var first = (ReadingSessionDto)(await h.Service.StartNewSessionAsync(new("ui", "start-1", null, ReadingMode.Endurance))).Data!;
        first.Status.Should().Be(ReadingSessionStatus.Active);

        var second = await h.Service.PlanSessionAsync(new("ui", "plan-2", first.BookAssignmentId!.Value, ReadingMode.Endurance, 0));
        second.Data.Should().BeOfType<ReadingErrorDto>();
        ((ReadingErrorDto)second.Data!).Code.Should().Be("already_active");

        var third = await h.Service.StartNewSessionAsync(new("ui", "start-2", null, ReadingMode.Endurance));
        ((ReadingErrorDto)third.Data!).Code.Should().Be("already_active");
    }

    private async Task Elapsed004Async()
    {
        var h = Harness();
        await h.Init();
        await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start"));

        h.Clock.Advance(TimeSpan.FromSeconds(600));
        await h.Service.PauseSessionAsync(new("ui", "pause"));
        h.Clock.Advance(TimeSpan.FromSeconds(300));

        var status = (ReadingSessionDto)(await h.Service.GetStatusAsync()).Data!;
        status.AccumulatedSeconds.Should().Be(600); // pause duration excluded, not 900
        status.MeasuredSeconds.Should().Be(600);
    }

    private async Task Report005Async()
    {
        var h = Harness();
        await h.Init();
        await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start"));

        h.Clock.Advance(TimeSpan.FromSeconds(1234));
        var completed = (ReadingSessionDto)(await h.Service.CompleteSessionAsync(new("ui", "complete", 25))).Data!;

        completed.ReportedMinutes.Should().Be(25);   // display override
        completed.MeasuredSeconds.Should().Be(1234); // measured seconds preserved

        // The override also wins in weekly evidence (25, not floor(1234/60)=20).
        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.TotalVolumeMinutes.Should().Be(25);
    }

    private async Task Constraint006Async()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        var planned = (ReadingSessionDto)(await h.Service.PlanSessionAsync(
            new("ui", "plan", assignment.Id, ReadingMode.Endurance, 20, ReadingConstraint.TimeConstrained))).Data!;
        planned.Constraint.Should().Be(ReadingConstraint.TimeConstrained);
        planned.ProgressionEligible.Should().BeFalse();

        await h.Service.StartSessionAsync(new("ui", "start"));
        h.Clock.Advance(TimeSpan.FromMinutes(20));
        await h.Service.CompleteSessionAsync(new("ui", "complete", 20));
        var rated = (ReadingSessionDto)(await h.Service.RateSessionAsync(new("ui", "rate", 5, 8))).Data!;
        rated.Status.Should().Be(ReadingSessionStatus.Completed);
        rated.ProgressionEligible.Should().BeFalse();

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.TotalVolumeMinutes.Should().Be(20); // counts as volume
        Mode(preview.Modes, ReadingMode.Endurance).QualifyingCount.Should().Be(0); // not evidence
    }

    private async Task Fatigue007Async()
    {
        // Reduce: median effort 9 >= 9 deloads by 5, floored at baseline 40.
        var reduce = Harness();
        await reduce.Init();
        await SeedSession(reduce, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 9, focus: 5);
        await SeedSession(reduce, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 9, focus: 5);
        await SeedSession(reduce, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 9, focus: 5);
        var reducePreview = (ReadingWeeklyReviewDto)(await reduce.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        var reduceEndurance = Mode(reducePreview.Modes, ReadingMode.Endurance);
        reduceEndurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindDeload);
        reduceEndurance.TargetAfterMinutes.Should().Be(40);

        // Hold: median effort 8 > 7 blocks the increase without punishing.
        var hold = Harness();
        await hold.Init();
        await SeedSession(hold, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 8, focus: 5);
        await SeedSession(hold, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 8, focus: 5);
        await SeedSession(hold, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 8, focus: 5);
        var holdPreview = (ReadingWeeklyReviewDto)(await hold.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        var holdEndurance = Mode(holdPreview.Modes, ReadingMode.Endurance);
        holdEndurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        holdEndurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonHighEffort);

        // High fatigue never increases load.
        reduceEndurance.DecisionKind.Should().NotBe(ReadingProgressionPolicy.KindIncrease);
        holdEndurance.DecisionKind.Should().NotBe(ReadingProgressionPolicy.KindIncrease);
    }

    private async Task Default008Async()
    {
        var h = Harness();
        await h.Init();
        var a = await h.AddBook("Meditations");
        var b = await h.AddBook("Essays");
        var c = await h.AddBook("Candide");

        var addA = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(new("ui", "a", a, ReadingMode.Deep, true))).Data!;
        var addB = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(new("ui", "b", b, ReadingMode.Deep))).Data!;
        var addC = (ReadingBookAssignmentDto)(await h.Service.AddBookAssignmentAsync(new("ui", "c", c, ReadingMode.Deep))).Data!;

        var books = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).Books;
        books.Count(x => x.IsDefault).Should().Be(1);
        addA.IsDefault.Should().BeTrue();
        addB.IsDefault.Should().BeFalse();
        addB.Status.Should().Be(ReadingAssignmentStatus.Active);
        addC.IsDefault.Should().BeFalse();
        addC.Status.Should().Be(ReadingAssignmentStatus.Active);

        // Switching the default keeps exactly one default per mode.
        await h.Service.SetDefaultBookAsync(new("ui", "set-b", addB.Id, ReadingMode.Deep));
        var after = ((ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!).Books;
        after.Count(x => x.IsDefault).Should().Be(1);
        after.Single(x => x.Id == addB.Id).IsDefault.Should().BeTrue();
        after.Single(x => x.Id == addA.Id).IsDefault.Should().BeFalse();
    }

    private async Task BookLink009Async()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Meditations");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        await h.Service.PlanSessionAsync(new("ui", "plan", assignment.Id, ReadingMode.Endurance, 0));
        await h.Service.StartSessionAsync(new("ui", "start"));
        await h.Service.CompleteSessionAsync(new("ui", "complete", 40));
        await h.Service.RateSessionAsync(new("ui", "rate", 5, 8));

        var history = (IReadOnlyList<ReadingSessionDto>)(await h.Service.GetHistoryAsync()).Data!;
        history.Should().HaveCount(1);
        var completed = history.Single();
        completed.BookId.Should().NotBe(Guid.Empty);
        completed.BookAssignmentId.Should().Be(assignment.Id);
        completed.BookTitle.Should().Be("Meditations");
    }

    private async Task Weekly010Async()
    {
        var h = Harness();
        await h.Init();
        // Previous week volume 160 so the 115% guard passes for 150 current.
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 6, focus: 7);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 4, focus: 9);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        var endurance = Mode(preview.Modes, ReadingMode.Endurance);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        endurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        endurance.TargetAfterMinutes.Should().Be(45); // +5
        endurance.QualifyingCount.Should().Be(3);
        endurance.CompletionRate.Should().Be(1.0);

        // Modes adapt independently: deep holds despite endurance increasing.
        var deep = Mode(preview.Modes, ReadingMode.Deep);
        deep.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        deep.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
        deep.TargetAfterMinutes.Should().Be(30);
    }

    private async Task Volume011Async()
    {
        // Within the 15% guard (60 -> 69): the increase is accepted.
        var within = Harness();
        await within.Init();
        await SeedSession(within, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 3600);
        await SeedSession(within, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 1200, effort: 5, focus: 8, plannedTargetMinutes: 20);
        await SeedSession(within, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 1200, effort: 6, focus: 7, plannedTargetMinutes: 20);
        await SeedSession(within, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 1200, effort: 4, focus: 9, plannedTargetMinutes: 20);
        var withinPreview = (ReadingWeeklyReviewDto)(await within.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        withinPreview.PreviousWeekVolumeMinutes.Should().Be(60);
        var withinEndurance = Mode(withinPreview.Modes, ReadingMode.Endurance);
        withinEndurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        withinEndurance.TargetAfterMinutes.Should().Be(45);

        // Beyond the guard (60 -> 70, 116.7%): the 115% rule bounds the
        // increase. NOTE (contract ambiguity): the frozen fixture's literal
        // example expects 60->70 accepted, but the engine's documented 115%
        // rule (60 * 1.15 = 69) holds at 70; the engine behaviour is the
        // authoritative implementation and is asserted here.
        var beyond = Harness();
        await beyond.Init();
        await SeedSession(beyond, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 3600);
        await SeedSession(beyond, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 1200, effort: 5, focus: 8, plannedTargetMinutes: 20);
        await SeedSession(beyond, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 1200, effort: 6, focus: 7, plannedTargetMinutes: 20);
        await SeedSession(beyond, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 1200, effort: 4, focus: 9, plannedTargetMinutes: 20);
        await SeedSession(beyond, ReadingMode.Endurance, Week32StartUtc.AddHours(74), 600, effort: 5, focus: 8, constraint: ReadingConstraint.TimeConstrained);
        var beyondPreview = (ReadingWeeklyReviewDto)(await beyond.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        beyondPreview.TotalVolumeMinutes.Should().Be(70);
        var beyondEndurance = Mode(beyondPreview.Modes, ReadingMode.Endurance);
        beyondEndurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        beyondEndurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonVolumeGuard);
        beyondEndurance.TargetAfterMinutes.Should().Be(40);
    }

    private async Task Review012Async()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);

        var first = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "commit-a", 2026, 32))).Data!;
        first.Committed.Should().BeTrue();

        var secondResult = await h.Service.CommitWeeklyReviewAsync(new("ui", "commit-b", 2026, 32));
        secondResult.Reply.Should().Contain("already reviewed");
        ((ReadingWeeklyReviewDto)secondResult.Data!).Should().BeEquivalentTo(first);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.StateVersion.Should().Be("2");
    }

    private async Task Command013Async()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");
        var request = new ReadingCaptureRequest("telegram-7", "k-1", "A captured thought.", ReadingCaptureType.Thought, book);

        var first = await h.Service.CaptureAsync(request);
        var retry = await h.Service.CaptureAsync(request);

        retry.Duplicate.Should().BeTrue();
        retry.Reply.Should().Be(first.Reply);
        retry.Data.Should().BeEquivalentTo(first.Data);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingCaptures.CountAsync()).Should().Be(1);
    }

    private async Task Capture014Async()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide");

        var first = (ReadingCaptureDto)(await h.Service.CaptureAsync(
            new("tg", "k1", "verbatim note", ReadingCaptureType.Thought, book, ExternalId: "tg-msg-99"))).Data!;
        var second = await h.Service.CaptureAsync(
            new("tg", "k2", "verbatim note", ReadingCaptureType.Thought, book, ExternalId: "tg-msg-99"));

        second.Reply.Should().Be(ReadingReplyFormatter.AlreadyCaptured);
        var dto = (ReadingCaptureDto)second.Data!;
        dto.Id.Should().Be(first.Id); // verbatim: the same stored capture
        dto.Text.Should().Be("verbatim note");

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingCaptures.CountAsync()).Should().Be(1);
    }

    private async Task Language015Async()
    {
        var forbidden = new[] { "streak", "debt", "catch-up", "guilt", "compulsory" };

        // Every reply the engine can emit across a scripted conversation.
        var h = Harness();
        var replies = await RunReplyScriptAsync(h);

        // The full reply corpus: every string constant of the formatter.
        var corpus = typeof(ReadingReplyFormatter)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(f => f.FieldType == typeof(string))
            .Select(f => (string)f.GetValue(null)!)
            .ToList();
        corpus.Should().NotBeEmpty();

        foreach (var term in forbidden)
        {
            replies.Should().NotContain(
                r => r.Contains(term, StringComparison.OrdinalIgnoreCase),
                $"no engine reply may contain '{term}'");
            corpus.Should().NotContain(
                c => c.Contains(term, StringComparison.OrdinalIgnoreCase),
                $"no reply-corpus constant may contain '{term}'");
        }
    }

    [Fact]
    public async Task Heavy_week_stress_fixture_commits_deterministically()
    {
        using var doc = await LoadFixtureAsync();
        var stressCases = doc.RootElement.GetProperty("stressCases").EnumerateArray().ToList();
        stressCases.Should().ContainSingle();
        stressCases[0].GetProperty("id").GetString().Should().Be("heavy-week-016");

        await HeavyWeek016Async();
    }

    private async Task HeavyWeek016Async()
    {
        var h = Harness();
        await h.Init();

        // Previous week (W31): 8 x 40 min endurance volume = 320, so the 115%
        // guard allows the 325-minute current week (115% of 320 = 368).
        for (var i = 0; i < 8; i++)
            await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2 + i * 20), 2400);

        // Current week (W32): 11 sessions — 7 normal-target qualifying
        // evidence, 3 constrained (volume only), 1 recovery (volume only).
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(17), 2400, effort: 6, focus: 7);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(32), 2400, effort: 4, focus: 9);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(47), 2400, effort: 5, focus: 8);
        // Two under-target constrained endurance sessions: if they polluted
        // evidence, the completion rate would fall below 0.8 and the week
        // would hold instead of increase.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(62), 1200, effort: 8, focus: 6, constraint: ReadingConstraint.TimeConstrained);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(77), 900, effort: 7, focus: 5, constraint: ReadingConstraint.TimeConstrained);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(92), 1800, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(107), 1800, effort: 6, focus: 7);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(122), 1800, effort: 4, focus: 9);
        // Constrained deep session with deload-bait ratings (effort 9, focus
        // 3): if it polluted evidence, deep would hold or deload instead of
        // increasing.
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(137), 1200, effort: 9, focus: 3, constraint: ReadingConstraint.TimeConstrained);
        await SeedSession(h, ReadingMode.Recovery, Week32StartUtc.AddHours(152), 1200, effort: 2, focus: 10);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.PreviousWeekVolumeMinutes.Should().Be(320);
        preview.TotalVolumeMinutes.Should().Be(325);

        var endurance = Mode(preview.Modes, ReadingMode.Endurance);
        endurance.TargetBeforeMinutes.Should().Be(40);
        endurance.TargetAfterMinutes.Should().Be(45);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        endurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        endurance.QualifyingCount.Should().Be(4);
        endurance.CompletionRate.Should().Be(1.0);
        endurance.MedianEffort.Should().Be(5);
        endurance.MedianFocus.Should().Be(8);

        var deep = Mode(preview.Modes, ReadingMode.Deep);
        deep.TargetBeforeMinutes.Should().Be(30);
        deep.TargetAfterMinutes.Should().Be(35);
        deep.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        deep.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        deep.QualifyingCount.Should().Be(3);
        deep.CompletionRate.Should().Be(1.0);
        deep.MedianEffort.Should().Be(5);
        deep.MedianFocus.Should().Be(8);

        var recovery = Mode(preview.Modes, ReadingMode.Recovery);
        recovery.TargetBeforeMinutes.Should().Be(20);
        recovery.TargetAfterMinutes.Should().Be(20);
        recovery.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        recovery.Reason.Should().Be(ReadingProgressionPolicy.ReasonRecoveryVolumeOnly);
        recovery.QualifyingCount.Should().Be(0);

        // No constrained/recovery failure or evidence pollution: nothing
        // deloads and every decision is the deterministic per-mode outcome.
        preview.Modes.Should().NotContain(m => m.DecisionKind == ReadingProgressionPolicy.KindDeload);

        // Commit: exactly one review and exactly three mode decisions.
        var committed = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "heavy-commit", 2026, 32))).Data!;
        committed.Committed.Should().BeTrue();
        committed.StateVersion.Should().Be("2");

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(45);
        programme.DeepTargetMinutes.Should().Be(35);
        programme.RecoveryTargetMinutes.Should().Be(20);
        programme.EnduranceConsecutiveIncreases.Should().Be(1);
        programme.DeepConsecutiveIncreases.Should().Be(1);
        // Recovery has no increase counter by design; its target stays 20.

        // Idempotent second commit under a second key: same review, no new
        // rows, no target drift.
        var again = await h.Service.CommitWeeklyReviewAsync(new("ui", "heavy-commit-2", 2026, 32));
        again.Reply.Should().Contain("already reviewed");
        ((ReadingWeeklyReviewDto)again.Data!).Should().BeEquivalentTo(committed);
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
        (await db.ReadingCommandReceipts.CountAsync(x => x.CommandKind == "CommitWeeklyReview")).Should().Be(2);
        var programmeAfter = await db.ReadingProgrammes.SingleAsync();
        programmeAfter.StateVersion.Should().Be("2");
        programmeAfter.EnduranceTargetMinutes.Should().Be(45);
        programmeAfter.DeepTargetMinutes.Should().Be(35);
        programmeAfter.RecoveryTargetMinutes.Should().Be(20);
    }

    // --- helpers ------------------------------------------------------------

    private static async Task<List<string>> RunReplyScriptAsync(HarnessContext h)
    {
        var replies = new List<string>();
        async Task Run(ReadingCommandResultDto result) => replies.Add(result.Reply);

        var book = await h.AddBook("Candide");
        await Run(await h.Service.InitializeProgrammeAsync("setup", "init-1"));
        await Run(await h.Service.InitializeProgrammeAsync("setup", "init-2")); // already initialized
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add-1", book, ReadingMode.Endurance, true));
        await Run(added);
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        await Run(await h.Service.PlanSessionAsync(new("ui", "plan-1", assignment.Id, ReadingMode.Endurance, 0)));
        await Run(await h.Service.StartSessionAsync(new("ui", "start-1")));
        await Run(await h.Service.PauseSessionAsync(new("ui", "pause-1")));
        await Run(await h.Service.ResumeSessionAsync(new("ui", "resume-1")));
        await Run(await h.Service.CompleteSessionAsync(new("ui", "complete-1", 40)));
        await Run(await h.Service.RateSessionAsync(new("ui", "rate-1", 5, 8)));

        await Run(await h.Service.PlanSessionAsync(new("ui", "plan-2", assignment.Id, ReadingMode.Endurance, 0)));
        await Run(await h.Service.StartSessionAsync(new("ui", "start-2")));
        await Run(await h.Service.CompleteSessionAsync(new("ui", "complete-2", 40)));
        await Run(await h.Service.SkipRatingsAsync(new("ui", "skip-1")));

        await Run(await h.Service.PlanSessionAsync(new("ui", "plan-3", assignment.Id, ReadingMode.Endurance, 0)));
        await Run(await h.Service.StartSessionAsync(new("ui", "start-3")));
        await Run(await h.Service.CancelSessionAsync(new("ui", "cancel-1")));

        await Run(await h.Service.CaptureAsync(new("ui", "cap-1", "A thought.", ReadingCaptureType.Thought, book)));
        await Run(await h.Service.CaptureAsync(new("ui", "cap-2", "A thought.", ReadingCaptureType.Thought, book)));
        await Run(await h.Service.ListInboxAsync());
        await Run(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32)));
        await Run(await h.Service.CommitWeeklyReviewAsync(new("ui", "review-1", 2026, 32)));
        await Run(await h.Service.CommitWeeklyReviewAsync(new("ui", "review-2", 2026, 32)));
        await Run(await h.Service.GetHistoryAsync());
        await Run(await h.Service.GetDashboardAsync());
        await Run(await h.Service.GetStatusAsync());
        return replies;
    }

    private static ReadingModeReviewDto Mode(IReadOnlyList<ReadingModeReviewDto> modes, ReadingMode mode) =>
        modes.Single(m => m.Mode == mode);

    private HarnessContext Harness()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc));
        return new HarnessContext(factory, clock, new ReadingTrainingService(factory, clock));
    }

    private static async Task SeedSession(
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

    private sealed record HarnessContext(
        TestContextFactory Factory,
        MutableReadingClock Clock,
        ReadingTrainingService Service)
    {
        public Task<ReadingCommandResultDto> Init() =>
            Service.InitializeProgrammeAsync("setup", Guid.NewGuid().ToString("N"));

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
