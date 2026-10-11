/** Independent real HTTP/WS cookie owner, without the headless application's single-instance lock. */
import { createWebuiHandler, nodeHttpAdapter } from '../../../packages/server-core/src/webui'
import { WsRpcServer } from '../../../packages/server-core/src/transport'
const handler = createWebuiHandler({
  webuiDir: process.env.PHANERIS_WEBUI_DIR!, secret: process.env.PHANERIS_SERVER_TOKEN!,
  revocationStorePath: process.env.GOVERNANCE_REVOCATIONS,
  wsProtocol: 'ws', wsPort: 0, getHealthCheck: () => ({ status: 'ok' }),
  logger: { info: console.log, warn: console.warn, error: console.error, debug: () => {} },
})
const rpc = new WsRpcServer({ port: 0, requireAuth: true,
  validateToken: async token => token === process.env.PHANERIS_SERVER_TOKEN,
  validateSessionCookie: handler.validateSessionCookie, httpHandler: nodeHttpAdapter(handler.fetch) })
await rpc.listen()
console.log(`PHANERIS_SERVER_URL=ws://127.0.0.1:${rpc.port}`)
process.on('SIGTERM', () => { rpc.close(); handler.dispose(); process.exit(0) })
