/**
 * MCP client using official @modelcontextprotocol/sdk
 * Supports both HTTP and stdio transports for remote and local MCP servers
 */

import { PRODUCT_SLUG } from '../identity.generated.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { GetPromptResult, ListPromptsResult, ListResourcesResult, ListResourceTemplatesResult, ReadResourceResult, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { DurableToolExecutionIdentity } from '../durable-runtime/types.ts';
import { durableToolMeta } from './durable-tool-meta.ts';

/**
 * HTTP transport config for remote MCP servers
 */
export interface HttpMcpClientConfig {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Stdio transport config for local MCP servers (spawns subprocess)
 */
export interface StdioMcpClientConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /**
   * Working directory for the spawned process.
   *
   * Plugin-provided servers always run from their plugin root so their
   * relative-path view stays inside the package (design §5.4.1).
   */
  cwd?: string;
}

/**
 * Unified config supporting both transport types
 */
export type McpClientConfig = HttpMcpClientConfig | StdioMcpClientConfig;

/**
 * Sensitive environment variables that should NOT be passed to MCP subprocesses.
 * These could contain API keys, tokens, or credentials that MCP servers don't need
 * and shouldn't have access to.
 * NOTE: This list is duplicated in packages/session-tools-core/src/handlers/transform-data.ts (BLOCKED_ENV_VARS).
 * If you add a new entry here, update it there too.
 */
const BLOCKED_ENV_VARS = [
  // Claude/Anthropic credentials
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',

  // AWS credentials
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',

  // Common API keys/tokens
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'STRIPE_SECRET_KEY',
  'NPM_TOKEN',
];

/**
 * Per-call options for PoolClient.callTool.
 * Forwarded to the MCP SDK's RequestOptions so aborts become protocol-level
 * cancellation notifications instead of orphaned in-flight requests.
 */
export interface PoolCallToolOptions {
  /** Host metadata; never injected into external MCP arguments. */
  intent?: string;
  /** Cancels the in-flight request when aborted */
  signal?: AbortSignal;
  /** Request timeout in ms (SDK default applies when omitted) */
  timeoutMs?: number;
  /** Durable execution identity forwarded as MCP request metadata. */
  durableTool?: DurableToolExecutionIdentity;
}

/**
 * Interface for clients managed by McpClientPool.
 * Both CraftMcpClient (remote MCP sources) and ApiSourcePoolClient (API sources) implement this.
 */
export interface PoolClient {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown>;
  close(): Promise<void>;
  getServerCapabilities?(): ServerCapabilities | undefined;
  getInstructions?(): string | undefined;
  listResources?(cursor?: string, options?: PoolRequestOptions): Promise<ListResourcesResult>;
  listResourceTemplates?(cursor?: string, options?: PoolRequestOptions): Promise<ListResourceTemplatesResult>;
  readResource?(uri: string, options?: PoolRequestOptions): Promise<ReadResourceResult>;
  listPrompts?(cursor?: string, options?: PoolRequestOptions): Promise<ListPromptsResult>;
  getPrompt?(name: string, args?: Record<string, string>, options?: PoolRequestOptions): Promise<GetPromptResult>;
}

export type PoolRequestOptions = Pick<PoolCallToolOptions, 'signal' | 'timeoutMs'>;
const requestOptions = (options?: PoolRequestOptions) => ({ signal: options?.signal, ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}) });

export class CraftMcpClient {
  private client: Client;
  private transport: Transport;
  private connected = false;
  private connecting?: Promise<void>;
  private closing?: Promise<void>;
  private generation = 0;
  private initialTools?: Tool[];

  constructor(config: McpClientConfig) {
    this.client = new Client({
      // The client name is sent to remote MCP servers on initialize, so it
      // identifies THIS product; the upstream brand is never claimed.
      name: PRODUCT_SLUG,
      version: '1.0.0',
    });

    // Create transport based on config type
    if (config.transport === 'stdio') {
      // Stdio transport for local MCP servers - merge with process env,
      // but filter out sensitive credentials to prevent leaking secrets to subprocesses
      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !BLOCKED_ENV_VARS.includes(key)) {
          processEnv[key] = value;
        }
      }
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...processEnv, ...config.env },
        // Omitted when undefined, which leaves the SDK's default (process cwd).
        cwd: config.cwd,
      });
    } else {
      // HTTP transport for remote MCP servers
      this.transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
        }
      );
    }
  }

  async connect(): Promise<void> {
    if (this.closing) await this.closing;
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    const generation = this.generation;
    const connecting = (async () => {
      try {
        await this.client.connect(this.transport);
        try {
          if (this.client.getServerCapabilities()?.tools) this.initialTools = (await this.client.listTools()).tools;
        } catch (error) {
          // Keep the transport's HTTP status on the wrapped error: a 401 during
          // the health check must still classify as "needs auth" even when the
          // response body carries no recognizable text.
          const status = (error as { code?: unknown } | null)?.code;
          const wrapped = new Error(`MCP connection failed health check: ${error instanceof Error ? error.message : String(error)}`);
          if (typeof status === 'number') (wrapped as { code?: number }).code = status;
          throw wrapped;
        }
        if (generation !== this.generation) throw new Error('MCP connection cancelled');
        this.connected = true;
      } catch (error) {
        await this.client.close().catch(() => {});
        throw error;
      }
    })();
    this.connecting = connecting;
    try { await connecting }
    finally { if (this.connecting === connecting) this.connecting = undefined }
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      await this.connect();
      const tools = this.initialTools;
      this.initialTools = undefined;
      if (tools) return tools;
    }
    this.initialTools = undefined;
    if (!this.client.getServerCapabilities()?.tools) return [];
    const result = await this.client.listTools();
    return result.tools;
  }

  /**
   * Returns server name/version reported during the MCP handshake.
   * Available after `connect()` resolves; undefined otherwise.
   */
  getServerCapabilities(): ServerCapabilities | undefined { return this.client.getServerCapabilities(); }
  getInstructions(): string | undefined { return this.client.getInstructions(); }
  async listResources(cursor?: string, options?: PoolRequestOptions): Promise<ListResourcesResult> {
    if (!this.connected) await this.connect();
    return this.client.listResources(cursor ? { cursor } : undefined, requestOptions(options));
  }
  async listResourceTemplates(cursor?: string, options?: PoolRequestOptions): Promise<ListResourceTemplatesResult> {
    if (!this.connected) await this.connect();
    return this.client.listResourceTemplates(cursor ? { cursor } : undefined, requestOptions(options));
  }
  async readResource(uri: string, options?: PoolRequestOptions): Promise<ReadResourceResult> {
    if (!this.connected) await this.connect();
    return this.client.readResource({ uri }, requestOptions(options));
  }
  async listPrompts(cursor?: string, options?: PoolRequestOptions): Promise<ListPromptsResult> {
    if (!this.connected) await this.connect();
    return this.client.listPrompts(cursor ? { cursor } : undefined, requestOptions(options));
  }
  async getPrompt(name: string, args?: Record<string, string>, options?: PoolRequestOptions): Promise<GetPromptResult> {
    if (!this.connected) await this.connect();
    return this.client.getPrompt({ name, arguments: args }, requestOptions(options));
  }

  getServerInfo(): { name: string; version: string } | undefined {
    const info = this.client.getServerVersion();
    if (!info) return undefined;
    return { name: info.name, version: info.version };
  }

  async callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await this.client.callTool({
      name,
      arguments: args,
      ...(options?.durableTool ? {
        _meta: durableToolMeta(options.durableTool),
      } : {}),
    }, undefined, {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
    return result;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.generation++;
    this.connected = false;
    this.initialTools = undefined;
    const connecting = this.connecting;
    const closing = (async () => {
      await this.client.close();
      await connecting?.catch(() => {});
    })();
    this.closing = closing;
    try { await closing }
    finally { if (this.closing === closing) this.closing = undefined }
  }
}
