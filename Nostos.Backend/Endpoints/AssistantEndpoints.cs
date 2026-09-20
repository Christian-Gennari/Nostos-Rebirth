using Nostos.Backend.Configuration;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services.Ai;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Endpoints;

/// <summary>
/// The assistant HTTP surface (issue #261 §3, §7):
/// <list type="bullet">
/// <item><c>GET /api/assistant/status</c> — the single source of availability.</item>
/// <item><c>POST /api/assistant/turn</c> — one conversational turn with the
/// in-process tool loop.</item>
/// <item><c>POST /api/assistant/plan/approve</c> — execute exactly one pending
/// plan, identified by its plan id and approval token.</item>
/// </list>
///
/// The provider credential lives only behind the server: it is read from the
/// environment at call time and is never part of a request or response body.
/// Every failure is returned as data with a stable code, so a client gets a typed
/// error instead of a 404/500 — and nothing silently falls back to another
/// provider. Availability is derived once in <see cref="AssistantOptions.IsAvailable"/>.
/// </summary>
public static class AssistantEndpoints
{
    public const string StatusRoute = "/api/assistant/status";
    public const string TurnRoute = "/api/assistant/turn";
    public const string ApproveRoute = "/api/assistant/plan/approve";

    public static IEndpointRouteBuilder MapAssistantEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/assistant");
        group.MapGet("/status", Status);
        group.MapPost("/turn", TurnAsync);
        group.MapPost("/plan/approve", ApproveAsync);
        return routes;
    }

    /// <summary>
    /// The client's only source of availability: <c>{ "available": true|false }</c>.
    /// It answers even when the hard kill switch is off (the answer is simply
    /// false), and carries no hint of the credential — the key is tested for
    /// presence and never read into the response.
    /// </summary>
    private static IResult Status(AssistantOptions options) =>
        Results.Ok(new AssistantStatusResponse(options.IsAvailable()));

    private static async Task<IResult> TurnAsync(
        AssistantTurnRequest request,
        AssistantOrchestrator orchestrator,
        AssistantOptions options,
        CancellationToken ct)
    {
        var unavailable = Unavailable(options);
        if (unavailable is not null) return unavailable;

        try
        {
            return Results.Ok(await orchestrator.HandleTurnAsync(request, ct));
        }
        catch (LlmException ex)
        {
            return Failure(ex.Code, StatusFor(ex.Code), ex.Message);
        }
    }

    private static async Task<IResult> ApproveAsync(
        AssistantPlanApproveRequest request,
        AssistantOrchestrator orchestrator,
        AssistantOptions options,
        CancellationToken ct)
    {
        var unavailable = Unavailable(options);
        if (unavailable is not null) return unavailable;

        var response = await orchestrator.ApproveAsync(request.PlanId, request.ApprovalToken, ct);
        if (response.Success)
        {
            return Results.Ok(response);
        }

        var code = response.ErrorCode ?? AssistantErrorCodes.NotFound;
        return Failure(code, StatusForApproval(code), response.ErrorMessage ?? "The plan was refused.");
    }

    /// <summary>
    /// The one gate every route shares: null when the assistant is available,
    /// otherwise the typed 503. The <see cref="LlmErrorCodes.Disabled"/> /
    /// <see cref="LlmErrorCodes.NotConfigured"/> distinction is preserved so the
    /// client can still tell a kill switch from a missing key.
    /// </summary>
    private static IResult? Unavailable(AssistantOptions options)
    {
        if (options.IsAvailable()) return null;

        return options.Enabled
            ? Failure(
                LlmErrorCodes.NotConfigured,
                StatusCodes.Status503ServiceUnavailable,
                LlmException.NotConfigured(options.ApiKeyEnvironmentVariable).Message)
            : Failure(
                LlmErrorCodes.Disabled,
                StatusCodes.Status503ServiceUnavailable,
                LlmException.Disabled().Message);
    }

    /// <summary>
    /// Code → HTTP status for LLM/provider failures. A permission problem is a
    /// bad gateway (our credential, not the caller's), never a 401 the browser
    /// would read as "the user is not signed in".
    /// </summary>
    private static int StatusFor(string code) => code switch
    {
        LlmErrorCodes.Disabled or LlmErrorCodes.NotConfigured => StatusCodes.Status503ServiceUnavailable,
        LlmErrorCodes.Permission => StatusCodes.Status502BadGateway,
        _ => StatusCodes.Status502BadGateway,
    };

    /// <summary>Code → HTTP status for a refused approval. Refusals are terminal and mutate nothing.</summary>
    private static int StatusForApproval(string code) => code switch
    {
        AssistantErrorCodes.NotFound => StatusCodes.Status404NotFound,
        AssistantErrorCodes.ApprovalPlanMismatch => StatusCodes.Status409Conflict,
        _ => StatusCodes.Status400BadRequest,
    };

    private static IResult Failure(string code, int statusCode, string detail) =>
        Results.Problem(statusCode: statusCode, title: code, detail: detail);
}

/// <summary>
/// The availability answer returned by <c>GET /api/assistant/status</c>. A
/// single boolean on purpose: it must never carry, log, or hint at the provider
/// credential, so there is nothing here for a key to leak into.
/// </summary>
public sealed record AssistantStatusResponse(bool Available);
