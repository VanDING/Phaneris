/**
 * MCP Pool Server
 *
 * Serves McpClientPool tools over HTTP using the MCP Streamable HTTP protocol.
 * This allows external SDK subprocesses (Codex, Copilot) to access pool-managed
 * MCP source tools through a single HTTP endpoint instead of connecting to each
 * source independently.
 *
 * Uses Streamable HTTP transport in stateless mode because Codex uses the
 * Streamable HTTP protocol (POST-based JSON-RPC). Stateless mode means no
 * session tracking — each request is independent.
 *
 * Architecture:
 *   Codex/Copilot SDK subprocess
 *       ↓ (HTTP Streamable HTTP protocol)
 *   McpPoolServer (this, in Electron main process)
 *       ↓
 *   McpClientPool
 *       ↓ (per-source MCP connections)
 *   Linear / GitHub / Notion / etc.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpClientPool } from './mcp-pool.ts';

export class McpPoolServer {
  private pool: McpClientPool;
  private httpServer: HttpServer | null = null;
  private requests = new Set<{ server: Server; transport: StreamableHTTPServerTransport }>();
  private debugFn: ((msg: string) => void) | undefined;
  private _port = 0;

  constructor(pool: McpClientPool, options?: { debug?: (msg: string) => void }) {
    this.pool = pool;
    this.debugFn = options?.debug;
  }

  private debug(msg: string): void {
    this.debugFn?.(`[McpPoolServer] ${msg}`);
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp`;
  }

  /**
   * Start the HTTP MCP server on a random port.
   * Returns the URL clients should connect to.
   */
  async start(): Promise<string> {
    if (this.httpServer) {
      return this.url;
    }

    this.httpServer = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);
      if (url.pathname !== '/mcp') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      // SDK 1.32 forbids reusing stateless transports across requests. The
      // protocol instance is short-lived; the Source pool remains host-owned.
      const request = { server: this.createMcpServer(), transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, enableJsonResponse: true,
      }) };
      this.requests.add(request);
      const cleanup = async () => {
        if (!this.requests.delete(request)) return;
        await request.server.close().catch(() => {});
        await request.transport.close().catch(() => {});
      };
      res.once('close', () => { void cleanup(); });
      res.once('finish', () => { void cleanup(); });
      try {
        await request.server.connect(request.transport);
        await request.transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'MCP request failed' } }));
        } else res.destroy();
        await cleanup();
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.httpServer!.address();
        this._port = typeof addr === 'object' && addr ? addr.port : 0;
        this.debug(`Listening on 127.0.0.1:${this._port}`);
        resolve();
      });
      this.httpServer!.on('error', reject);
    });

    return this.url;
  }

  /**
   * Create an MCP Server instance wired to the pool.
   * Tools from pool use `mcp__craft__search_spaces` naming internally.
   * We strip the `mcp__` prefix so Codex (which adds its own `mcp__sources__`
   * prefix based on the POOL_SERVER_MCP_NAME) sees clean names:
   *   pool internal: mcp__craft__search_spaces
   *   exposed here:  craft__search_spaces
   *   Codex sees:    mcp__sources__craft__search_spaces
   */
  private createMcpServer(): Server {
    const server = new Server(
      { name: 'craft-pool-proxy', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // List tools — proxy from pool, strip `mcp__` prefix
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const proxyDefs = this.pool.getProxyToolDefs();
      return {
        tools: proxyDefs.map(def => ({
          name: def.name.replace(/^mcp__/, ''),
          description: def.description,
          ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}),
          ...(def.annotations ? { annotations: def.annotations } : {}),
          inputSchema: def.inputSchema as {
            type: 'object';
            properties?: Record<string, unknown>;
          },
        })),
      };
    });

    // Call tool — add `mcp__` prefix back before routing through pool
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const internalName = `mcp__${name}`;
      this.debug(`Tool call: ${name} → ${internalName}`);

      const result = await this.pool.callTool(internalName, args || {});

      return {
        content: result.contentBlocks?.length ? result.contentBlocks as CallToolResult['content'] : [{ type: 'text' as const, text: result.content }],
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        ...(result.isError ? { isError: true } : {}),
      };
    });

    return server;
  }

  /**
   * Notify that the tool list has changed.
   * In stateless mode this is a no-op — source changes already trigger
   * `regenCodexConfigAndReconnect()` which restarts the app-server,
   * and it re-discovers tools on startup.
   */
  notifyToolsChanged(): void {
    this.debug('Tools changed (stateless mode — clients will discover on next connect)');
  }

  /**
   * Stop the HTTP server and close the transport.
   */
  async stop(): Promise<void> {
    const requests = [...this.requests];
    this.requests.clear();
    await Promise.all(requests.map(async request => {
      await request.server.close().catch(() => {});
      await request.transport.close().catch(() => {});
    }));

    if (this.httpServer) {
      this.httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
      this._port = 0;
      this.debug('Stopped');
    }
  }
}
