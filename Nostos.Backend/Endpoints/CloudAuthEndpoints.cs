using Microsoft.AspNetCore.Authentication;
using Nostos.Backend.Security;

namespace Nostos.Backend.Endpoints;

public static class CloudAuthEndpoints
{
    public static IEndpointRouteBuilder MapCloudAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/auth/login", (string? returnUrl) =>
        {
            var redirectUri = NormalizeLocalReturnUrl(returnUrl);
            return Results.Challenge(
                new AuthenticationProperties { RedirectUri = redirectUri },
                new[] { CloudAuthSchemes.Oidc });
        }).AllowAnonymous();

        routes.MapPost("/api/auth/logout", (string? returnUrl) =>
        {
            var redirectUri = NormalizeLocalReturnUrl(returnUrl);
            return Results.SignOut(
                new AuthenticationProperties { RedirectUri = redirectUri },
                new[] { CloudAuthSchemes.Cookie, CloudAuthSchemes.Oidc });
        }).AllowAnonymous();

        routes.MapGet("/api/auth/session", GetSessionAsync)
            .AllowAnonymous();

        return routes;
    }

    public static async Task<CloudSessionResponse> GetSessionAsync(
        HttpContext httpContext,
        ICloudAccountContextResolver accountResolver,
        ICloudAccountStatusStore statusStore,
        CancellationToken cancellationToken)
    {
        if (!accountResolver.TryResolve(httpContext.User, out var account) || account is null)
            return CloudSessionResponse.Anonymous;

        var status = await statusStore.GetStatusAsync(account.AccountId, cancellationToken);

        return new CloudSessionResponse(
            Authenticated: true,
            AccountState: status.ToString(),
            Account: new CloudSessionAccount(
                account.AccountId.ToString(),
                account.DisplayName,
                account.Email));
    }

    public static string NormalizeLocalReturnUrl(string? returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl))
            return "/";

        var value = returnUrl.Trim();
        if (!value.StartsWith("/", StringComparison.Ordinal)
            || value.StartsWith("//", StringComparison.Ordinal)
            || value.Contains('\\')
            || value.Contains('\r')
            || value.Contains('\n'))
        {
            return "/";
        }

        return value;
    }
}

public sealed record CloudSessionAccount(
    string Id,
    string DisplayName,
    string? Email);

public sealed record CloudSessionResponse(
    bool Authenticated,
    string? AccountState,
    CloudSessionAccount? Account)
{
    public static CloudSessionResponse Anonymous { get; } = new(
        Authenticated: false,
        AccountState: null,
        Account: null);
}
