using Nostos.Backend.Services.Ai;

namespace Nostos.Backend.Endpoints;

/// <summary>
/// The AI provider settings surface (assistant-milestone plan, "AI provider
/// settings"). Four routes under one group:
/// <list type="bullet">
/// <item><c>GET /api/settings/ai-provider</c> — effective LLM + STT config.</item>
/// <item><c>PUT /api/settings/ai-provider</c> — partial update of either
/// section; the apiKey is tri-state (null = unchanged, "" = clear, value =
/// store).</item>
/// <item><c>POST /api/settings/ai-provider/models</c> — the endpoint's model
/// list (<c>{baseUrl}/models</c>, then <c>{baseUrl}/v1/models</c>).</item>
/// <item><c>POST /api/settings/ai-provider/test</c> — one real, minimal provider
/// call; ALWAYS 200 so the UI can render the outcome.</item>
/// </list>
///
/// No response ever carries the key or its ciphertext: only <c>hasKey</c> and
/// <c>keyFromServerEnv</c>.
/// </summary>
public static class AiProviderSettingsEndpoints
{
    public const string Route = "/api/settings/ai-provider";
    public const string ModelsRoute = Route + "/models";
    public const string TestRoute = Route + "/test";

    public static IEndpointRouteBuilder MapAiProviderSettingsEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet(Route, GetAsync);
        routes.MapPut(Route, UpdateAsync);
        routes.MapPost(ModelsRoute, ListModelsAsync);
        routes.MapPost(TestRoute, TestAsync);
        return routes;
    }

    private static async Task<IResult> GetAsync(
        IAiProviderSettingsService settings,
        CancellationToken ct) =>
        Results.Ok(await settings.GetAsync(ct));

    private static async Task<IResult> UpdateAsync(
        AiProviderSettingsUpdateRequest request,
        IAiProviderSettingsService settings,
        CancellationToken ct)
    {
        try
        {
            return Results.Ok(await settings.UpdateAsync(request, ct));
        }
        catch (AiProviderValidationException ex)
        {
            return ValidationFailure(ex.Message);
        }
    }

    private static async Task<IResult> ListModelsAsync(
        AiProviderModelsRequest request,
        IAiProviderSettingsService settings,
        CancellationToken ct)
    {
        try
        {
            return Results.Ok(await settings.ListModelsAsync(request, ct));
        }
        catch (AiProviderValidationException ex)
        {
            return ValidationFailure(ex.Message);
        }
        catch (AiProviderUpstreamException ex)
        {
            // 502 with the provider's own message: the shape the UI renders.
            return Results.Json(
                new { error = ex.Message },
                statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static async Task<IResult> TestAsync(
        AiProviderTestRequest request,
        IAiProviderSettingsService settings,
        CancellationToken ct) =>
        // Always 200: the service reports a refusal as {ok:false,error}.
        Results.Ok(await settings.TestAsync(request, ct));

    private static IResult ValidationFailure(string message) =>
        Results.BadRequest(new { error = message });
}
