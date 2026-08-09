using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.ReadingTraining;

/// <summary>
/// Nostos-owned raw-text gateway dispatcher. Maps canonical reading controls
/// and raw active-session captures in a single free-text message to exactly
/// one <see cref="IReadingTrainingService"/> operation; the service remains
/// the sole authority for sessions, captures, progression, timing, and
/// idempotency. No transport, connector, or model logic lives here.
/// </summary>
public interface IReadingGatewayDispatcher
{
    /// <summary>
    /// Dispatch one raw gateway message. Returns the stable
    /// <see cref="ReadingCommandResultDto"/> envelope unchanged: a service
    /// mutation envelope (fresh, rejected, or duplicate), a read-only status
    /// envelope, or the stable <c>gateway_ignored</c> no-op envelope for
    /// messages the gateway never acts on (slash commands, model-driven
    /// queries, or ordinary text without an active session).
    /// </summary>
    Task<ReadingCommandResultDto> DispatchAsync(
        ReadingGatewayDispatchRequest request, CancellationToken ct = default);
}
