using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.ReadingTraining;

// Deterministic Reading Training domain service. Nostos SQLite is the sole
// authority: no Hermes runtime, process, or file dependency. Every mutating
// command accepts (ClientId, IdempotencyKey), runs inside one transaction
// behind a process-local async command gate, and returns the stored original
// response on duplicate retries; database constraints remain the final
// concurrency guard.
//
// Task 4A1 vertical slice: programme initialization, books/queue, and
// plan/start/pause/resume. Complete/rate/skip/cancel, captures, and the
// weekly review are added by Task 4A2.
public interface IReadingTrainingService
{
    // --- programme ---
    Task<ReadingCommandResultDto> InitializeProgrammeAsync(
        string clientId, string idempotencyKey, CancellationToken ct = default);

    Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct = default);
    Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct = default);
    Task<ReadingCommandResultDto> GetHistoryAsync(CancellationToken ct = default);

    // --- books / queue ---
    Task<ReadingCommandResultDto> AddBookAssignmentAsync(ReadingAddBookAssignmentRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> SetDefaultBookAsync(ReadingSetDefaultBookRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> CompleteBookAsync(ReadingCompleteBookRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> ReorderQueueAsync(ReadingReorderQueueRequest request, CancellationToken ct = default);

    // --- sessions (Task 4A1: plan / start / pause / resume) ---
    Task<ReadingCommandResultDto> PlanSessionAsync(ReadingPlanSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> StartSessionAsync(ReadingStartSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> StartNewSessionAsync(ReadingStartNewSessionRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> PauseSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default);
    Task<ReadingCommandResultDto> ResumeSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default);
}
