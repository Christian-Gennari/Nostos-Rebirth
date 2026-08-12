/**
 * Task 13 E2E — minimal MCP Streamable HTTP client wrapper around the real
 * Nostos MCP server (/mcp, bearer-token authenticated). Every tool call is
 * forwarded verbatim to the server; results are parsed from the tool result
 * content (text JSON or structuredContent) into the stable
 * ReadingCommandResultDto envelope shape used across REST/UI/MCP.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { FixtureState } from './fixture';
import type { CommandEnvelope } from './fixture';

export interface McpToolResult {
  content: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown> | null;
  isError?: boolean;
}

export class McpSession {
  private readonly client: Client;
  private connected = false;

  constructor(private readonly fixture: FixtureState) {
    this.client = new Client({ name: 'nostos-e2e', version: '1.0.0' });
  }

  async connect(): Promise<void> {
    const url = new URL('/mcp', this.fixture.baseUrl);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: { Authorization: `Bearer ${this.fixture.token}` },
      },
    });
    await this.client.connect(transport);
    this.connected = true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.connected) throw new Error(`MCP client not connected (tool ${name})`);
    const result = await this.client.callTool({ name, arguments: args });
    return result as McpToolResult;
  }

  /** Calls a tool and parses its text/structured content into the command envelope. */
  async command(name: string, args: Record<string, unknown>): Promise<CommandEnvelope<any>> {
    const raw = await this.callTool(name, args);
    if (raw.isError) throw new Error(`MCP tool ${name} reported isError: ${JSON.stringify(raw)}`);
    for (const item of raw.content ?? []) {
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim() !== '') {
        try {
          return JSON.parse(item.text) as CommandEnvelope<any>;
        } catch {
          // not JSON; fall through to structuredContent
        }
      }
    }
    if (raw.structuredContent) {
      return raw.structuredContent as unknown as CommandEnvelope<any>;
    }
    throw new Error(`MCP tool ${name} returned no parseable envelope: ${JSON.stringify(raw)}`);
  }

  async close(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      await this.client.close();
    }
  }
}

/** One-shot convenience: connect, run a single tool command, close. */
export async function mcpCommand(
  fixture: FixtureState,
  name: string,
  args: Record<string, unknown>
): Promise<CommandEnvelope<any>> {
  const session = new McpSession(fixture);
  await session.connect();
  try {
    return await session.command(name, args);
  } finally {
    await session.close();
  }
}
