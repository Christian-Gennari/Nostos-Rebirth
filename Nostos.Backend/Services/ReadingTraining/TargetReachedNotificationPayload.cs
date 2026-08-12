using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

// Typed payload of a target-reached outbox notification. Serialized with
// System.Text.Json (camelCase, declaration order) so the stored PayloadJson
// is deterministic and round-trips exactly. The message is deliberately calm
// and factual: the achieved elapsed time only — no guilt, streak, debt or
// catch-up framing.
public sealed record TargetReachedNotificationPayload
{
    public Guid NotificationId { get; init; }
    public Guid SessionId { get; init; }
    public Guid BookId { get; init; }
    public ReadingMode Mode { get; init; }
    public int PlannedTargetMinutes { get; init; }
    public long EffectiveElapsedSeconds { get; init; }
    public string Message { get; init; } = string.Empty;

    public static TargetReachedNotificationPayload Create(
        Guid notificationId,
        Guid sessionId,
        Guid bookId,
        ReadingMode mode,
        int plannedTargetMinutes,
        long effectiveElapsedSeconds) => new()
    {
        NotificationId = notificationId,
        SessionId = sessionId,
        BookId = bookId,
        Mode = mode,
        PlannedTargetMinutes = plannedTargetMinutes,
        EffectiveElapsedSeconds = effectiveElapsedSeconds,
        Message = $"Reading target reached: {effectiveElapsedSeconds / 60} minutes elapsed (planned {plannedTargetMinutes} minutes).",
    };
}
