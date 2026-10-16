// Local protocol fixture: a real stdio transport, no external account or subprocess side effects.
import { createInterface } from 'node:readline'
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { id?: number; method: string }
  if (request.id === undefined) continue
  let result: unknown
  if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { resources: {} }, serverInfo: { name: 'governance-stdio', version: '1' } }
  else if (request.method === 'resources/list') result = { resources: [] }
  else if (request.method === 'resources/templates/list') result = { resourceTemplates: [] }
  else if (request.method === 'resources/read') result = { contents: [{ uri: 'fixture://config', text: JSON.stringify({ argument: process.argv[2], marker: process.env.PHANERIS_VERIFY_MCP_VALUE, cwd: process.cwd() }) }] }
  else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n')
    continue
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
}
