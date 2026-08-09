using System.ComponentModel;
using ModelContextProtocol.Server;

namespace Nostos.Backend.Integrations.Mcp;

/// <summary>
/// Minimal generic tool used to verify MCP discovery before domain tools are registered.
/// It exposes no configuration, environment, filesystem, or persisted data.
/// </summary>
[McpServerToolType]
public static class NostosMcpIdentityTools
{
    [McpServerTool(Name = "nostos_server_info")]
    [Description("Returns the public identity of the Nostos MCP server.")]
    public static object GetServerInfo() => new { name = "nostos" };
}
