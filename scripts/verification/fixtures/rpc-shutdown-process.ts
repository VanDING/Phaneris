import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { WsRpcServer } from '../../../packages/server-core/src/transport/server'
import { CliRpcClient } from '../../../apps/cli/src/client'

const [mode, evidence] = process.argv.slice(2)
if (!mode || !evidence) throw new Error('Shutdown fixture arguments required')
const disconnected: string[] = []
const server = new WsRpcServer({ host: '127.0.0.1', port: 0, onClientDisconnected: id => disconnected.push(id) })
server.handle('fixture:echo', (_context, value) => value)
await server.listen()
const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`)
await client.connect()
assert.equal(await client.invoke('fixture:echo', 'ready'), 'ready')
if (mode === 'server-first') { server.close(); client.destroy() }
else { client.destroy(); if (mode === 'settled-client') await Bun.sleep(50); server.close() }
await Bun.sleep(50)
assert.equal(disconnected.length, 1, 'Disconnect callbacks still run during shutdown')
writeFileSync(evidence, JSON.stringify({ mode, disconnected: disconnected.length, pid: process.pid, naturalExitRequired: true }))
// Do not force exit: a late close callback must not retain a reconnect TTL timer.
