/**
 * In-process MCP client for REST API sources.
 *
 * Connects to an in-process McpServer (built by createInProcessMcpServer) via
 * in-memory transport, exposing it through the same PoolClient interface
 * that CraftMcpClient uses for remote MCP sources.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PoolCallToolOptions, PoolClient } from './client.ts';
import { durableToolMeta } from './durable-tool-meta.ts';

export class ApiSourcePoolClient implements PoolClient {
  private client: Client;
  private connected = false;
  private intentTools = new Set<string>();
  private toolsLoaded = false;

  constructor(private mcpServer: McpServer) {
    this.client = new Client({ name: 'craft-pool-api-source', version: '1.0.0' });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect both ends
    await this.mcpServer.connect(serverTransport);
    await this.client.connect(clientTransport);

    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) await this.connect();
    const result = await this.client.listTools();
    this.intentTools = new Set(result.tools.filter(tool => Object.hasOwn(tool.inputSchema.properties ?? {}, '_intent')).map(tool => tool.name));
    this.toolsLoaded = true;
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown> {
    if (!this.connected) await this.connect();
    options?.signal?.throwIfAborted();
    if (options?.intent && !this.toolsLoaded) await this.listTools();
    return this.client.callTool({
      name,
      arguments: options?.intent && this.intentTools.has(name) ? { ...args, _intent: options.intent } : args,
      ...(options?.durableTool ? { _meta: durableToolMeta(options.durableTool) } : {}),
    }, undefined, {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close().catch(() => {});
      this.connected = false;
      this.toolsLoaded = false;
    }
  }
}
