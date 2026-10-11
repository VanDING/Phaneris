/** Owns the source pool and its HTTP lease; owns no session execution state. */
import { McpClientPool, McpPoolServer } from '@phaneris/shared/mcp'
import type { CoreBackendConfig } from '@phaneris/shared/agent/backend'

export interface SessionSourceResources {
  readonly pool: McpClientPool
  readonly server?: McpPoolServer
  readonly url?: string
  release(): Promise<void>
}

export async function prepareSessionSourceResources(input: {
  workspaceRootPath: string
  sessionPath: string
  servers: NonNullable<CoreBackendConfig['initialSources']>['mcpServers']
  needsHttpServer: boolean
  debug?: (message: string) => void
}): Promise<SessionSourceResources> {
  const pool = new McpClientPool({ debug: input.debug, workspaceRootPath: input.workspaceRootPath, sessionPath: input.sessionPath })
  const server = input.needsHttpServer ? new McpPoolServer(pool, { debug: input.debug }) : undefined
  let releasing: Promise<void> | undefined
  const release = (): Promise<void> => releasing ??= (async () => {
    pool.onToolsChanged = undefined
    const results = await Promise.allSettled([Promise.resolve().then(() => server?.stop()), pool.disconnectAll()])
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Failed to release session source resources')
  })()
  try {
    let url: string | undefined
    if (server) {
      pool.onToolsChanged = () => server.notifyToolsChanged()
      url = await server.start()
      await pool.sync(input.servers)
    }
    return Object.freeze({ pool, server, url, release })
  } catch (error) {
    try { await release() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Source preparation and rollback failed') }
    throw error
  }
}
