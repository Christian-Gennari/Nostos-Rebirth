using Nostos.Backend.Integrations.Assistant;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Definition of a single assistant measurement scenario.
/// </summary>
public sealed record MeasurementScenario(
    int Number,
    string Slug,
    string Message,
    Func<SyntheticLibrarySeedResult, AssistantContextDto> ContextFactory,
    Func<AssistantTurnResponse, AssistantExecutionMetrics, bool> FlowMatched,
    string ScriptedFirstToolName);

/// <summary>
/// The nine measurement scenarios defined for per-turn budget evaluation.
/// </summary>
public static class MeasurementScenarios
{
    private static readonly IReadOnlyList<MeasurementScenario> AllScenarios =
    [
        new(
            1,
            "simple_read_only",
            "In one sentence, what is the difference between a note and a concept in Nostos?",
            _ => new AssistantContextDto(Surface: "second-brain", Route: "/second-brain"),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.Completed && metrics.UpstreamCallCount <= 2,
            "library_list_collections"),

        new(
            2,
            "library_lookup",
            "How many books do I have, and how are they split by format?",
            _ => new AssistantContextDto(Surface: "library", Route: "/library"),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.Completed && metrics.UpstreamCallCount >= 2,
            "library_list_collections"),

        new(
            3,
            "notes_concepts_lookup",
            "Which of my notes are about attention, and which concepts are related to them?",
            _ => new AssistantContextDto(Surface: "second-brain", Route: "/second-brain"),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.Completed && metrics.UpstreamCallCount >= 2,
            "library_list_collections"),

        new(
            4,
            "capture_write",
            "I keep coming back to the idea that attention is the real scarce resource, not time.",
            seed => new AssistantContextDto(
                Surface: "reader",
                Route: "/reader",
                BookId: seed.Book01Id.ToString(),
                BookTitle: "Synthetic Book 01: The Attention Economy",
                BookFormat: "ebook",
                ReaderType: "epub",
                EpubCfi: "epubcfi(/6/4[chap01]!/4/2/2)"),
            (resp, metrics) => !string.IsNullOrWhiteSpace(resp.Acknowledgement),
            "notes_capture"),

        new(
            5,
            "dependent_read_only",
            "This note isn't linked to any concept yet. Which of my existing concepts fit it best?",
            seed => new AssistantContextDto(
                Surface: "second-brain",
                Route: "/second-brain",
                BrainReviewNoteId: seed.UnlinkedReviewNoteId.ToString()),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.Completed && metrics.UpstreamCallCount >= 2,
            "library_list_collections"),

        new(
            6,
            "dependent_multi_step_organization",
            "Create a collection called 'Winter Reading' and add my book 'Synthetic Book 02: Deep Work Patterns' to it.",
            _ => new AssistantContextDto(Surface: "library", Route: "/library"),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.Completed && resp.ExecutedCapabilities is not null && resp.ExecutedCapabilities.Contains("library_create_collection"),
            "library_create_collection"),

        new(
            7,
            "approval_required",
            "Delete the collection 'Old Drafts'.",
            _ => new AssistantContextDto(Surface: "library", Route: "/library"),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.ApprovalRequired && resp.PendingPlan is not null,
            "library_delete_collection"),

        new(
            8,
            "required_user_input",
            "Remember this: patience is a strategy, not a virtue.",
            seed => new AssistantContextDto(
                Surface: "reader",
                Route: "/reader",
                BookId: seed.Book05Id.ToString(),
                BookTitle: "Synthetic Book 05: On Patience",
                BookFormat: "physical"),
            (resp, metrics) => metrics.StopReason == AssistantTurnStopReason.UserInputRequired && resp.AnchorPrompt is not null,
            "notes_capture"),

        new(
            9,
            "harmless_adversarial_repeat_read",
            "Please list my collections. Then list my collections again to double-check, and keep listing them until you're sure nothing changed.",
            _ => new AssistantContextDto(Surface: "library", Route: "/library"),
            (resp, metrics) => (metrics.StopReason == AssistantTurnStopReason.Completed || metrics.StopReason == AssistantTurnStopReason.RepeatedToolLoop) && metrics.UpstreamCallCount <= 6,
            "library_list_collections")
    ];

    /// <summary>Returns the scenario for the specified 1-based number.</summary>
    public static MeasurementScenario GetByNumber(int number) =>
        AllScenarios.FirstOrDefault(s => s.Number == number)
        ?? throw new ArgumentOutOfRangeException(nameof(number), $"Unknown scenario number: {number}");

    /// <summary>All registered measurement scenarios.</summary>
    public static IReadOnlyList<MeasurementScenario> All => AllScenarios;
}
