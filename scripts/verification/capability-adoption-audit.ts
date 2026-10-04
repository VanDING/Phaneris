/** Pinned public API audit and native branch-store workflow. No network or ambient credentials. */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCodemodeExtension, createMcpExtension, SessionManager } from '@earendil-works/pi-coding-agent'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
const root = resolve(import.meta.dir, '../..'), records: any[] = [], branchResults: any[] = []
async function check(id: string, fn: () => any) { try { records.push({ id, pass: true, observation: await fn() }) } catch (error) { records.push({ id, pass: false, error: String(error) }) } }
await check('Native codemode persists store values on the active branch and exposes no models global', async () => {
  const session = SessionManager.inMemory(root)
  let tool: any
  createCodemodeExtension({ models: false })({ registerTool(definition: any) { tool = definition },
    appendEntry(type: string, data: any) { session.appendCustomEntry(type, data) },
    getSettings() { return {} }, getAllTools() { return [] },
  } as any)
  const ctx = { sessionManager: session, tools: [], cwd: root, executeTool() { throw new Error('Unexpected external effect') } }
  const execute = async (code: string) => { const result = await tool.execute('branch-fixture', { code }, new AbortController().signal, undefined, ctx); branchResults.push(result); return result.content.map((item: any) => item.text ?? '').join('\n') }
  assert((await execute('store("marker", "a"); return load("marker");')).includes('Script completed'))
  const branchPoint = session.getLeafId()!
  await execute('store("marker", "b"); return load("marker");')
  session.branch(branchPoint)
  const restored = await execute('return { marker: load("marker"), models: typeof models };')
  assert(/"marker":\s*"a"/.test(restored)); assert(!/"marker":\s*"b"/.test(restored))
  assert(restored.includes('undefined'))
  return { branchRestored: true, modelsEnabled: false }
})
await check('Provider-owned offline refresh is scoped; conditional migrations remain explicit', async () => {
  const models = builtinModels({ credentials: new InMemoryCredentialStore() })
  const before = models.getModels('anthropic')
  const refreshed = await models.refresh({ providers: ['anthropic'], allowNetwork: false })
  assert.equal(refreshed.errors.size, 0); assert.equal(refreshed.aborted, false)
  assert.deepEqual(models.getModels('anthropic'), before)
  assert.equal(typeof createMcpExtension, 'function')
  const dynamic = models.getProviders().filter(provider => provider.refreshModels).map(provider => provider.id)
  const sdkRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), '..')
  const mcpContract = readFileSync(resolve(sdkRoot, 'dist/extensions/mcp/index.d.ts'), 'utf8')
  assert(mcpContract.includes('mcp.json')); assert(mcpContract.includes('mcp-auth.json'))
  return { dynamicProviders: dynamic, offlineModels: before.length,
    mcpContractSha256: createHash('sha256').update(mcpContract).digest('hex'),
    decisions: { nativeMcp: 'deferred: current source/vault/host ownership retained',
      radiusRouting: 'deferred: independently account and approve route selection before enabling',
      classifierDefault: 'retained: score distributions and structured state are not equivalent',
      extraTaskNodes: 'deferred: control semantics remain explicitly unsupported' } }
})
const output = resolve(root, '.cache/capability-integration/adoption-audit.json')
writeFileSync(output, JSON.stringify({ records, branchResults, scope: 'pinned API and local branch behavior; migration performance not measured' }, null, 2))
console.log(JSON.stringify({ output, records })); process.exit(records.every(record => record.pass) ? 0 : 1)
