namespace Nostos.Backend.Configuration;

// Model Context Protocol (MCP) Streamable HTTP foundation configuration
// (Task 9A). Frozen contract: the server is opt-in and disabled by default,
// exposed on a configurable absolute local route, and authenticated with a
// bearer token resolved exclusively from the named environment variable at
// startup. The token is never read from configuration and never written to
// logs or responses.
public sealed class McpOptions
{
    // Master switch; when false the application behaves exactly as before:
    // no middleware is registered and no MCP route is mapped.
    public bool Enabled { get; set; } = false;

    // Absolute local route the MCP Streamable HTTP endpoint is mapped to.
    // Validated and normalized at startup when Enabled is true.
    public string Path { get; set; } = "/mcp";

    // Name of the environment variable that holds the bearer token. Enabling
    // MCP without that variable set fails startup closed with a clear error.
    public string ApiKeyEnvironmentVariable { get; set; } = "NOSTOS_MCP_TOKEN";

    // Validates that `path` is a safe absolute local route and normalizes it:
    // it must begin with '/', must not be the application root, must not
    // contain query/fragment markers, wildcards, braces, backslashes,
    // whitespace or NUL, and must not contain empty, '.' or '..' segments.
    // A trailing slash is trimmed ("/mcp/" -> "/mcp"). On success the
    // normalized path is returned via `normalized`.
    public static bool TryNormalizePath(string? path, out string normalized, out string error)
    {
        normalized = string.Empty;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(path))
        {
            error = "the path is empty";
            return false;
        }

        if (!path.StartsWith('/'))
        {
            error = $"the path '{path}' must begin with '/'";
            return false;
        }

        if (path.IndexOfAny(['?', '#', '*', '{', '}', '\\', '\0', ' ', '\t']) >= 0)
        {
            error = "the path must not contain query or fragment markers, wildcards, braces, backslashes, whitespace or NUL";
            return false;
        }

        var trimmed = path.TrimEnd('/');
        if (trimmed.Length == 0)
        {
            error = "the path must not be the application root";
            return false;
        }

        if (trimmed.Contains("//"))
        {
            error = "the path must not contain empty segments";
            return false;
        }

        foreach (var segment in trimmed.Split('/'))
        {
            if (segment is "." or "..")
            {
                error = "the path must not contain '.' or '..' segments";
                return false;
            }
        }

        normalized = trimmed;
        return true;
    }
}
