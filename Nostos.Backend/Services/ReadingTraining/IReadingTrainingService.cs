using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.ReadingTraining;

// Deterministic Reading Training domain service. Nostos SQLite is the sole
// authority: no Hermes runtime, process, or file dependency. Every mutating
// command accepts (ClientId, IdempotencyKey), runs inside one transaction
// behind a process-local async command gate, and returns the stored original
// response on duplicate retries; database constraints remain the final
// concurrency guard.
public interface IReadingTrainingService
{
    // --- programme ---
    Task<ReadingCommandResultDto> InitializeProgrammeAsync(
        string clientId, string idempotencyKey, CancellationToken ct = default);

    Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct = default);
    Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct = default);
    Task<ReadingCommandResultDto> GetHistoryAsync(CancellationToken ct = default);
    Task<ReadingCommandResultDto> GetBooksAsync(CancellationToken ct = default);

    // --- books / queue ---
    Task<ReadingCommandResultDto> AddBookAssignmentAsync(ReadingAddBookAssignmentRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> SetDefaultBookAsync(ReadingSetDefaultBookRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> CompleteBookAsync(ReadingCompleteBookRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> ReorderQueueAsync(ReadingReorderQueueRequest request, CancellationToken ct = default);

    // --- sessions ---
    Task<ReadingCommandResultDto> PlanSessionAsync(ReadingPlanSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> StartSessionAsync(ReadingStartSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> StartNewSessionAsync(ReadingStartNewSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> PauseSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> ResumeSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> CompleteSessionAsync(ReadingCompleteSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> RateSessionAsync(ReadingRateSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> SkipRatingsAsync(ReadingSkipRatingsRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> CancelSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default);

    // --- weekly review ---
    Task<ReadingCommandResultDto> PreviewWeeklyReviewAsync(
        ReadingWeeklyReviewRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> CommitWeeklyReviewAsync(
        ReadingCommitWeeklyReviewRequest request, CancellationToken ct = default);

    // --- captures / inbox ---
    Task<ReadingCommandResultDto> CaptureAsync(ReadingCaptureRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> ListInboxAsync(CancellationToken ct = default);
    Task<ReadingCommandResultDto> ResolveCaptureAsync(Guid captureId, ReadingResolveCaptureRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> PromoteCaptureToNoteAsync(Guid captureId, ReadingPromoteCaptureRequest request, CancellationToken ct = default);
}
