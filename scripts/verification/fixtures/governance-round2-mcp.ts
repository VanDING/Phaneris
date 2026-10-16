/** Real stdio MCP fixture. All files, processes and delays are owned by one verification run. */
import { appendFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
const log = (event: object) => appendFileSync(process.env.PHANERIS_R2_MCP_LOG!, JSON.stringify({ pid: process.pid, ...event }) + '\n')
log({ event: 'spawn', marker: process.env.PHANERIS_R2_MARKER })
setInterval(() => {}, 60_000)
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { id?: number; method: string }
  log({ event: 'request', method: request.method })
  if (request.id === undefined) continue
  let result: unknown
  if (request.method === 'initialize') {
    const gate = process.env.PHANERIS_R2_GATE
    const deadline = Date.now() + 10_000
    while (gate && !existsSync(gate) && Date.now() < deadline) await Bun.sleep(10)
    await Bun.sleep(Number(process.env.PHANERIS_R2_INIT_DELAY ?? 0))
    result = { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'round2-fixture', version: '1' } }
  } else if (request.method === 'tools/list') {
    if (process.env.PHANERIS_R2_FAIL_TOOLS === 'true') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Synthetic catalog failure' } }) + '\n')
      continue
    }
    result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
  } else if (request.method === 'resources/list') result = { resources: [] }
  else if (request.method === 'resources/templates/list') result = { resourceTemplates: [] }
  else if (request.method === 'resources/read') result = { contents: [{ uri: 'fixture://identity', text: JSON.stringify({ pid: process.pid, marker: process.env.PHANERIS_R2_MARKER }) }] }
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: 'fixture result' }] }
  else continue
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
}
