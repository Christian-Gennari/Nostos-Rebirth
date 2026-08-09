using System.Text;
using FluentAssertions;
using Nostos.Backend.Services.ReadingTraining.Import;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

public sealed class HermesImportDryRunTests
{
    private static readonly Guid CandideBookId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    [Fact]
    public void BaselineFiles_ProduceDeterministicUnblockedPlan()
    {
        var dir = Fixture();
        var report = Plan(dir, [new(CandideBookId, "Candide", "Voltaire")]);

        report.Blocked.Should().BeFalse();
        report.Files.Should().HaveCount(3);
        report.AggregateFingerprint.Should().MatchRegex("^[0-9a-f]{64}$");
        report.Programme.Should().NotBeNull();
        report.Programme!.BaselineEnduranceMinutes.Should().Be(40);
        report.Programme.EnduranceTargetMinutes.Should().Be(40);
        report.Programme.TrainingPhase.Should().Be("base_building");
        report.Assignments.Should().ContainSingle();
        report.Assignments[0].BookId.Should().Be(CandideBookId);
        report.Assignments[0].Mode.Should().Be(ReadingMode.Endurance);
        report.Assignments[0].IsDefault.Should().BeTrue();
        report.Sessions.Should().BeEmpty();
        report.Captures.Should().BeEmpty();
        report.PlannedCounts.Should().Be(new HermesPlannedCounts(1, 1, 0, 0, 0, 0, 0));
    }

    [Fact]
    public void NonEmptyFiles_PreserveIdsTimestampsRatingsConstraintsAndCaptureText()
    {
        const string rawText = "  naïve line one\nline   two  ";
        var log = SessionJson("session-α", "completed", incident: false) + "\n" +
                  "{\"schema_version\":1,\"record_type\":\"rating\",\"session_id\":\"session-α\",\"effort\":4,\"focus\":8,\"rated_at\":\"2026-08-09T11:00:00+02:00\"}\n";
        var inbox = "{\"schema_version\":1,\"record_type\":\"capture\",\"id\":\"capture-β\",\"turn_id\":\"turn-9\",\"type\":\"question\",\"text\":" +
                    System.Text.Json.JsonSerializer.Serialize(rawText) +
                    ",\"captured_at\":\"2026-08-09T10:30:00+02:00\",\"date\":\"2026-08-09\",\"book_id\":\"voltaire-candide\",\"book_title\":\"Candide\",\"session_id\":\"session-α\"}\n";
        var dir = Fixture(log: log, inbox: inbox, includeOptional: true);

        var report = Plan(dir, [new(CandideBookId, "Candide", "Voltaire")]);

        report.Blocked.Should().BeFalse();
        report.Sessions.Should().ContainSingle();
        var session = report.Sessions[0];
        session.SourceSessionId.Should().Be("session-α");
        session.Status.Should().Be(ReadingSessionStatus.Completed);
        session.Constraint.Should().Be(ReadingConstraint.TimeConstrained);
        session.Effort.Should().Be(4);
        session.Focus.Should().Be(8);
        session.StartedAtRaw.Should().Be("2026-08-09T09:00:00+02:00");
        session.DoneAtRaw.Should().Be("2026-08-09T09:42:00+02:00");
        report.Captures.Should().ContainSingle();
        report.Captures[0].SourceCaptureId.Should().Be("capture-β");
        report.Captures[0].Text.Should().Be(rawText);
        report.Captures[0].Type.Should().Be(ReadingCaptureType.Question);
        report.Captures[0].PlannedSessionId.Should().Be(session.Id);
        report.SourceCounts.LogRecords.Should().Be(2);
        report.SourceCounts.InboxRecords.Should().Be(1);
    }

    [Fact]
    public void Fingerprint_IsIndependentOfDirectoryAndMtime_ButChangesWithBytes()
    {
        var first = Fixture(includeOptional: true);
        var second = Fixture(includeOptional: true);
        foreach (var name in Directory.GetFiles(second)) File.SetLastWriteTimeUtc(name, DateTime.UtcNow.AddDays(-20));

        var a = Plan(first, [new(CandideBookId, "Candide", "Voltaire")]);
        var b = Plan(second, [new(CandideBookId, "Candide", "Voltaire")]);
        a.AggregateFingerprint.Should().Be(b.AggregateFingerprint);
        a.Files.Should().BeEquivalentTo(b.Files, options => options.WithStrictOrdering());

        File.AppendAllText(Path.Combine(second, "reading-log.jsonl"), "\n", Utf8NoBom);
        var changed = Plan(second, [new(CandideBookId, "Candide", "Voltaire")]);
        changed.AggregateFingerprint.Should().NotBe(a.AggregateFingerprint);
    }

    [Fact]
    public void OpenSession_IsAHardBlocker()
    {
        var dir = Fixture(openSession: true, includeOptional: true);
        var report = Plan(dir, [new(CandideBookId, "Candide", "Voltaire")]);
        report.Blocked.Should().BeTrue();
        report.Blockers.Should().Contain(x => x.Code == HermesImportCodes.OpenSessionPending);
    }

    [Fact]
    public void NormalizedBookMatch_IsUnicodeWhitespaceAndCaseInvariant()
    {
        var dir = Fixture(title: "  CANDIDE  ", author: "Voltaire");
        var report = Plan(dir, [new(CandideBookId, "Candide", "voltaire")]);
        report.Blocked.Should().BeFalse();
        report.BookMappings.Single().Decision.Should().Be(HermesImportCodes.DecisionUniqueAuto);
    }

    [Fact]
    public void AmbiguousAndMissingBooks_Block_UntilExplicitMappingIsSupplied()
    {
        var dir = Fixture();
        var other = Guid.NewGuid();
        LibraryBookCandidate[] duplicates =
        [new(CandideBookId, "Candide", "Voltaire"), new(other, "Candide", "Voltaire")];
        var ambiguous = Plan(dir, duplicates);
        ambiguous.Blockers.Should().Contain(x => x.Code == HermesImportCodes.BookAmbiguous);

        var explicitReport = new HermesReadingImportPlanner().Plan(dir, duplicates,
            new Dictionary<string, Guid> { ["voltaire-candide"] = other });
        explicitReport.Blocked.Should().BeFalse();
        explicitReport.BookMappings.Single().Decision.Should().Be(HermesImportCodes.DecisionExplicitMatched);
        explicitReport.Assignments.Single().BookId.Should().Be(other);

        var missing = Plan(dir, []);
        missing.Blockers.Should().Contain(x => x.Code == HermesImportCodes.BookNotFound);
    }

    [Fact]
    public void OnlyExplicitIncidentMarkerSkipsCancelledSession()
    {
        var log = SessionJson("ordinary-cancel", "cancelled", incident: false) + "\n" +
                  SessionJson("incident-cancel", "cancelled", incident: true) + "\n" +
                  "{\"schema_version\":1,\"record_type\":\"rating_skipped\",\"session_id\":\"ordinary-cancel\",\"skipped_at\":\"2026-08-09T11:00:00+02:00\"}\n";
        var report = Plan(Fixture(log: log, includeOptional: true),
            [new(CandideBookId, "Candide", "Voltaire")]);

        report.Sessions.Should().ContainSingle(x => x.SourceSessionId == "ordinary-cancel");
        report.Sessions.Single().RatingsSkipped.Should().BeTrue();
        report.Sessions.Should().NotContain(x => x.SourceSessionId == "incident-cancel");
        report.Skips.Should().ContainSingle(x => x.Code == HermesImportCodes.IncidentPollution);
    }

    [Theory]
    [InlineData("{\"schema_version\":1,\"schema_version\":1}", HermesImportCodes.DuplicateJsonKey)]
    [InlineData("{\"schema_version\":1} trailing", HermesImportCodes.MalformedJson)]
    public void StrictJson_RejectsDuplicatePropertiesAndTrailingGarbage(string state, string code)
    {
        var dir = Fixture();
        File.WriteAllText(Path.Combine(dir, "training-state.json"), state, Utf8NoBom);
        var report = Plan(dir, []);
        report.Blockers.Should().Contain(x => x.Code == code);
    }

    [Fact]
    public void JsonlErrors_CarrySourceLine()
    {
        var dir = Fixture(log: "{}\n{broken\n", includeOptional: true);
        var report = Plan(dir, [new(CandideBookId, "Candide", "Voltaire")]);
        report.Blockers.Should().Contain(x => x.Code == HermesImportCodes.MalformedJson && x.File == "reading-log.jsonl" && x.Line == 2);
    }

    [Theory]
    [InlineData("schema_version: 1\ntimezone: Europe/Stockholm\ntimezone: UTC\n", HermesImportCodes.DuplicateYamlKey)]
    [InlineData("schema_version: 1\ntimezone: &zone Europe/Stockholm\n", HermesImportCodes.UnsafeYamlAlias)]
    public void StrictYaml_RejectsDuplicateKeysAndAnchors(string config, string code)
    {
        var dir = Fixture();
        File.WriteAllText(Path.Combine(dir, "config.yaml"), config, Utf8NoBom);
        var report = Plan(dir, []);
        report.Blockers.Should().Contain(x => x.Code == code);
    }

    [Fact]
    public void BoundsAndSymlinksFailClosed()
    {
        var oversized = Fixture();
        var limited = new HermesReadingImportPlanner().Plan(oversized, [], limits: new HermesImportLimits(MaxFileBytes: 10));
        limited.Blockers.Should().Contain(x => x.Code == HermesImportCodes.FileTooLarge);

        if (OperatingSystem.IsLinux())
        {
            var dir = Fixture();
            var queue = Path.Combine(dir, "reading-queue.yaml");
            var target = Path.Combine(Path.GetTempPath(), $"queue-{Guid.NewGuid():N}.yaml");
            File.WriteAllText(target, QueueYaml("Candide", "Voltaire"));
            File.Delete(queue);
            File.CreateSymbolicLink(queue, target);
            var report = Plan(dir, []);
            report.Blockers.Should().Contain(x => x.Code == HermesImportCodes.FileSymlink || x.Code == HermesImportCodes.PathEscape);
        }
    }

    [Fact]
    public void MissingOptionalFiles_AreAllowedButRequiredFilesAreNot()
    {
        var allowed = Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);
        allowed.Blockers.Should().NotContain(x => x.Code == HermesImportCodes.FileMissing);

        var dir = Fixture();
        File.Delete(Path.Combine(dir, "reading-queue.yaml"));
        Plan(dir, []).Blockers.Should().Contain(x => x.Code == HermesImportCodes.FileMissing && x.File == "reading-queue.yaml");
    }

    private static HermesImportDryRunReport Plan(string dir, IReadOnlyList<LibraryBookCandidate> books) =>
        new HermesReadingImportPlanner().Plan(dir, books);

    private static string Fixture(
        bool openSession = false,
        string log = "",
        string inbox = "",
        bool includeOptional = false,
        string title = "Candide",
        string author = "Voltaire")
    {
        var dir = Path.Combine(Path.GetTempPath(), "nostos-import-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "config.yaml"),
            "schema_version: 1\ntimezone: Europe/Stockholm\ninitial_targets:\n  endurance_minutes: 40\n  deep_minutes: 30\n  recovery_minutes: 20\n", Utf8NoBom);
        var active = openSession
            ? ",\"active\":{\"session_id\":\"open-1\",\"status\":\"paused\"}"
            : ",\"active\":null";
        var state = "{\"schema_version\":1,\"initialized_at\":\"2026-08-09T08:00:00+02:00\",\"targets\":{\"endurance\":40,\"deep\":30,\"recovery\":20},\"established_targets\":{\"endurance\":40,\"deep\":30,\"recovery\":20},\"consecutive_increases\":{\"endurance\":0,\"deep\":0},\"deloaded\":{\"endurance\":false,\"deep\":false},\"deload_week\":{\"endurance\":null,\"deep\":null},\"training_phase\":\"base_building\",\"queue\":[{\"id\":\"voltaire-candide\",\"title\":" +
                    System.Text.Json.JsonSerializer.Serialize(title) + ",\"author\":" +
                    System.Text.Json.JsonSerializer.Serialize(author) +
                    ",\"current_mode\":\"endurance\",\"status\":\"reading\",\"added_at\":\"2026-08-09T08:00:00+02:00\",\"completed_at\":null}]" + active + "}";
        File.WriteAllText(Path.Combine(dir, "training-state.json"), state, Utf8NoBom);
        File.WriteAllText(Path.Combine(dir, "reading-queue.yaml"), QueueYaml(title, author), Utf8NoBom);
        if (includeOptional || openSession)
        {
            File.WriteAllText(Path.Combine(dir, "active-session.json"),
                openSession ? "{\"schema_version\":1,\"active\":true,\"session_id\":\"open-1\",\"status\":\"paused\"}" : "{\"schema_version\":1,\"active\":false}", Utf8NoBom);
            File.WriteAllText(Path.Combine(dir, "reading-log.jsonl"), log, Utf8NoBom);
            File.WriteAllText(Path.Combine(dir, "reading-inbox.jsonl"), inbox, Utf8NoBom);
        }
        return dir;
    }

    private static string QueueYaml(string title, string author) =>
        "schema_version: 1\nactive:\n  endurance:\n    - id: voltaire-candide\n      title: " + title + "\n      author: " + author + "\n      current_mode: endurance\n      status: reading\n  deep: []\nup_next:\n  endurance: []\n  deep: []\ncompleted: []\n";

    private static string SessionJson(string id, string status, bool incident) =>
        "{\"schema_version\":1,\"record_type\":\"session\",\"id\":" + System.Text.Json.JsonSerializer.Serialize(id) +
        ",\"session_id\":" + System.Text.Json.JsonSerializer.Serialize(id) +
        ",\"date\":\"2026-08-09\",\"mode\":\"endurance\",\"book_id\":\"voltaire-candide\",\"book_title\":\"Candide\",\"author\":\"Voltaire\",\"planned_target\":40,\"session_target\":25,\"constraint\":\"time_constrained\",\"progression_eligible\":false,\"counts_as_failure\":false,\"started_at\":\"2026-08-09T09:00:00+02:00\",\"done_at\":\"2026-08-09T09:42:00+02:00\",\"active_seconds\":2520,\"clock_minutes\":42,\"actual_minutes\":42,\"reported_minutes\":42,\"completed_target\":true,\"completed_planned_target\":true,\"status\":" +
        System.Text.Json.JsonSerializer.Serialize(status) + (incident ? ",\"incident_marker\":\"isolation-incident\",\"accidental\":true" : "") + "}";
}
