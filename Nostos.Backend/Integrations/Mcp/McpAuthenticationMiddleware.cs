using System.Security.Cryptography;
using System.Text;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Integrations.Mcp;

// Bearer-token gate for the MCP Streamable HTTP endpoint (Task 9A).
//
// Only the configured MCP route and its descendants are gated; every other
// request passes through untouched. The expected token is captured at
// startup (see Program.cs) and is never part of configuration, logging, or
// responses. The comparison runs over SHA-256 hashes with
// CryptographicOperations.FixedTimeEquals so neither the token length nor
// the byte-comparison timing leaks information.
//
// OPTIONS is intentionally NOT exempted: Nostos does not enable CORS, so
// there is no legitimate preflight flow, and exempting OPTIONS would allow
// unauthenticated probing of the MCP transport. Failing closed for every
// method is the deliberate choice.
public sealed class McpAuthenticationMiddleware
{
    private const string BearerSchemePrefix = "Bearer ";

    private readonly RequestDelegate _next;
    private readonly McpOptions _options;
    private readonly byte[] _expectedTokenSha256;

    public McpAuthenticationMiddleware(RequestDelegate next, McpOptions options, string apiKey)
    {
        _next = next;
        _options = options;
        _expectedTokenSha256 = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey));
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Gate only the configured MCP route and its descendants.
        if (!_options.Enabled || !context.Request.Path.StartsWithSegments(_options.Path))
        {
            await _next(context);
            return;
        }

        var authorization = context.Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith(BearerSchemePrefix, StringComparison.OrdinalIgnoreCase))
        {
            await RejectUnauthorized(context);
            return;
        }

        var provided = authorization.AsSpan(BearerSchemePrefix.Length);
        if (provided.IsEmpty || provided.Contains(' '))
        {
            // Empty credential, or embedded whitespace: not an exact
            // `Authorization: Bearer <token>` value.
            await RejectUnauthorized(context);
            return;
        }

        var providedSha256 = SHA256.HashData(Encoding.UTF8.GetBytes(provided.ToString()));
        if (!CryptographicOperations.FixedTimeEquals(providedSha256, _expectedTokenSha256))
        {
            await RejectUnauthorized(context);
            return;
        }

        await _next(context);
    }

    private static async Task RejectUnauthorized(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.Headers.WWWAuthenticate = "Bearer";
        await context.Response.WriteAsJsonAsync(new { error = "Unauthorized." });
    }
}
