/** Child process without repository preloads: shipping interceptor -> real loopback HTTP. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [directory, rich] = process.argv.slice(2) as [string, string]
process.env.PHANERIS_CONFIG_DIR = join(directory, `config-${rich}`)
mkdirSync(process.env.PHANERIS_CONFIG_DIR, { recursive: true })
writeFileSync(join(process.env.PHANERIS_CONFIG_DIR, 'config.json'), JSON.stringify({ richToolDescriptions: rich === 'true' }))
const requests: Array<{ path: string; body: Record<string, any> }> = []
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  requests.push({ path: new URL(request.url).pathname, body: await request.json() as Record<string, any> })
  return Response.json({ fixture: true })
} })
try {
  await import('../../../packages/shared/src/unified-network-interceptor')
  const schema = () => ({ type: 'object', additionalProperties: false,
    properties: { file: { type: 'string' }, nested: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] } },
    required: ['file', 'nested'] })
  for (const api of ['chat/completions', 'responses']) {
    const definitions = ['read', 'mcp__fixture__read_record'].map(name => ({ name, strict: true, description: 'Fixture', parameters: schema() }))
    const tools = api === 'responses' ? definitions.map(definition => ({ type: 'function', ...definition }))
      : definitions.map(definition => ({ type: 'function', function: definition }))
    await fetch(new URL(api, server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      model: 'fixture', tools, ...(api === 'responses' ? { input: [{ role: 'user', content: 'Fixture' }] } : { messages: [{ role: 'user', content: 'Fixture' }] }),
    }) })
  }
  writeFileSync(join(directory, `schema-${rich}.json`), JSON.stringify(requests, null, 2))
  assert.equal(requests.length, 2)
  for (const request of requests) for (const tool of request.body.tools) {
    const parameters = (tool.function ?? tool).parameters
    assert.equal(parameters.additionalProperties, false, `${request.path}: preserve strict root schema`)
    assert.equal(parameters.properties.nested.additionalProperties, false)
    const metadataEnabled = rich === 'true' || (tool.function ?? tool).name.startsWith('mcp__')
    assert.equal('_intent' in parameters.properties, metadataEnabled)
    assert.equal('_displayName' in parameters.properties, metadataEnabled)
    if (metadataEnabled) assert(parameters.required.includes('_intent') && parameters.required.includes('_displayName'))
  }
} finally { await server.stop(true) }
