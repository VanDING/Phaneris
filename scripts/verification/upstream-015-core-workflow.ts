/** U15-01..13: real host modules, files, SDK loader and HTTP MCP; no external accounts. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upstream-015-core', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'profile')
  const checks: Array<{ id: string; pass: boolean; error?: string }> = []
  const check = async (id: string, fn: () => unknown | Promise<unknown>) => {
    try { await fn(); checks.push({ id, pass: true }) }
    catch (error) { checks.push({ id, pass: false, error: String(error) }) }
  }
  const workspace = join(run.directory, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const auth = await import('../../packages/session-tools-core/src/api-auth')
  await check('U15-02-http-header-map', () => {
    assert.deepEqual(auth.parseStoredApiCredential('{"x-custom-key":"fixture"}', { authType: 'header', headerName: 'x-default-key' }), { 'x-custom-key': 'fixture' })
    assert.equal(auth.parseJsonHeaderMap('{"bad header":"value"}'), null)
    assert.equal(auth.parseJsonHeaderMap('{"x-key":"one\\r\\ntwo"}'), null)
    const serviceAccount = JSON.stringify({ type: 'service_account', private_key: 'line one\nline two', client_email: 'fixture@example.invalid' })
    assert.equal(auth.parseStoredApiCredential(serviceAccount, { authType: 'header' }), serviceAccount)
    assert.deepEqual(auth.parseStoredApiCredential('{"username":"fixture","password":"synthetic"}', { authType: 'basic' }), { username: 'fixture', password: 'synthetic' })
  })
  await check('U15-01-refresh-workspace-isolation-and-deduplication', async () => {
    const { SourceCredentialManager } = await import('../../packages/shared/src/sources/credential-manager')
    const manager = new SourceCredentialManager()
    const calls: string[] = []
    Object.assign(manager, { doRefresh: async (source: { workspaceId: string }) => {
      calls.push(source.workspaceId); await Bun.sleep(10); return `synthetic-${source.workspaceId}`
    } })
    const source = (workspaceId: string) => ({ config: { slug: 'same-source' }, workspaceId, workspaceRootPath: join(workspace, workspaceId), folderPath: '' }) as Parameters<typeof manager.refresh>[0]
    const values = await Promise.all([manager.refresh(source('a')), manager.refresh(source('b')), manager.refresh(source('a'))])
    assert.deepEqual(values, ['synthetic-a', 'synthetic-b', 'synthetic-a'])
    assert.deepEqual(calls.sort(), ['a', 'b'])
    await manager.refresh(source('a')); assert.equal(calls.length, 3)
  })
  await check('U15-05-explicit-utility-and-provider-tier', async () => {
    const { getMiniModel, getSummarizationModel, PI_PREFERRED_DEFAULTS } = await import('../../packages/shared/src/config/llm-connections')
    const connection = { providerType: 'pi' as const, piAuthProvider: 'openai-codex', models: ['pi/gpt-6.1-sol', 'pi/gpt-6-luna'] }
    assert.equal(getMiniModel(connection), 'pi/gpt-6-luna')
    assert.equal(getSummarizationModel({ ...connection, utilityModel: 'pi/gpt-6.1-sol' }), 'pi/gpt-6.1-sol')
    assert.equal(getMiniModel({ providerType: 'pi', piAuthProvider: 'google', models: ['pi/gemini-2.5-pro', 'pi/gemini-2.5-flash'] }), 'pi/gemini-2.5-flash')
    assert.equal(PI_PREFERRED_DEFAULTS.anthropic?.[0], 'claude-opus-4-8')
  })
  await check('U15-04-label-contract-and-legacy-canonicalization', async () => {
    const { evaluateAutoLabels, newAutoLabelEntries } = await import('../../packages/shared/src/labels/auto')
    const { canonicalizeSessionLabels } = await import('../../packages/shared/src/labels/canonical')
    const labels: import('../../packages/shared/src/labels/types').LabelConfig[] = [
      { id: 'bug', name: 'Bug', color: 'accent', autoRules: [{ pattern: 'bug' }] },
      { id: 'issue', name: 'Issue', color: 'accent', valueType: 'string' as const, autoRules: [{ pattern: '(CRA-\\d+)' }] },
      { id: 'url', name: 'URL', color: 'accent', valueType: 'link' as const },
    ]
    const existing = ['bug::BUG', 'issue::CRA-1', 'issue::cra-1', 'url::https://example.invalid/A', 'url::https://example.invalid/a']
    const canonical = canonicalizeSessionLabels(existing, labels)
    assert.deepEqual(canonical, ['bug', 'issue::CRA-1', 'url::https://example.invalid/A', 'url::https://example.invalid/a'])
    const matches = evaluateAutoLabels('Bug bug BUG CRA-1 CRA-2 cra-2', labels, canonical)
    assert.deepEqual(newAutoLabelEntries(canonical, matches, labels), ['issue::CRA-2'])
  })
  await check('U15-06-pi-resource-settings-isolation', async () => {
    const { createPhanerisSettingsManager } = await import('../../packages/pi-agent-server/src/session-settings')
    const { createPhanerisResourceLoader } = await import('../../packages/pi-agent-server/src/phaneris-resource-loader')
    const piDir = join(workspace, '.pi'), agentDir = join(workspace, 'isolated-agent')
    mkdirSync(piDir, { recursive: true })
    writeFileSync(join(piDir, 'settings.json'), JSON.stringify({ defaultModel: 'foreign-model', packages: ['./must-not-load'] }))
    const settings = createPhanerisSettingsManager('ephemeral')
    const loader = await createPhanerisResourceLoader({ cwd: workspace, agentDir, settingsManager: settings, getPrompt: () => 'Host prompt' })
    assert.equal(settings.isProjectTrusted(), false)
    assert.equal(settings.getDefaultModel(), undefined)
    assert.equal(loader.getSystemPrompt(), 'Host prompt')
    assert(!existsSync(join(agentDir, 'settings.json')))
  })
  await check('U15-08-project-memory-tool-concurrent-append', async () => {
    const storage = await import('../../packages/shared/src/projects/storage')
    const { handleProjectMemoryAppend } = await import('../../packages/session-tools-core/src/handlers/project-memory')
    const defs = await import('../../packages/session-tools-core/src/tool-defs')
    const projectDir = join(workspace, 'projects', 'shared')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'MEMORY.md'), '# Existing knowledge\n\nKeep this.\n')
    const context = { appendProjectMemory: async ({ note }: { note: string }) => storage.appendProjectMemoryEntry(workspace, 'shared', 'Fixture', note) } as Parameters<typeof handleProjectMemoryAppend>[0]
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) => handleProjectMemoryAppend(context, { note: `Independent note ${index}.` })))
    for (const result of results) assert.notEqual(result.isError, true)
    const memory = readFileSync(join(projectDir, 'MEMORY.md'), 'utf8')
    assert(memory.startsWith('# Existing knowledge\n\nKeep this.\n'))
    for (let index = 0; index < 16; index++) assert(memory.includes(`Independent note ${index}.`))
    assert(defs.SESSION_SAFE_BLOCKED_TOOL_NAMES.has('project_memory_append'))
    assert.equal((await handleProjectMemoryAppend(context, { note: '  ' })).isError, true)
    assert.throws(() => storage.appendProjectMemoryEntry(workspace, '../outside', 'Fixture', 'no'), /project|slug|path/i)
    run.json('project-memory.json', { originalPreserved: true, appended: 16, text: memory })
  })
  await check('U15-09-project-memory-retains-old-and-new', async () => {
    const { loadProjectMemory } = await import('../../packages/shared/src/projects/storage')
    writeFileSync(join(workspace, 'projects/shared/MEMORY.md'), `# OLD-IMPORTANT\n${'中间知识 '.repeat(12_000)}\n## NEW-IMPORTANT\nLatest decision.`)
    const memory = loadProjectMemory(workspace, 'shared', 1000)!
    assert(memory.startsWith('# OLD-IMPORTANT')); assert(memory.endsWith('Latest decision.')); assert(memory.includes('omitted'))
    run.json('memory-window.json', { text: memory })
  })
  await check('U15-10-13-http-mcp-resources-prompts-without-tools', async () => {
    const { McpClientPool } = await import('../../packages/shared/src/mcp/mcp-pool')
    const { buildMcpSourceToolCallbacks } = await import('../../packages/server-core/src/sources/mcp-source-tool-callbacks')
    const calls: string[] = []
    let cursorLoop = false
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      if (request.method !== 'POST') return new Response('', { status: 405 })
      const rpc = await request.json() as { id?: number; method: string; params?: Record<string, unknown> }
      calls.push(rpc.method)
      if (rpc.id === undefined) return new Response(null, { status: 202 })
      let result: unknown
      if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { resources: {}, prompts: {} }, serverInfo: { name: 'resources-only-fixture', version: '1' }, instructions: 'Read the resource before using this source.' }
      else if (rpc.method === 'resources/list') result = { resources: [{ uri: `fixture://${rpc.params?.cursor ? 'last' : 'guide'}`, name: rpc.params?.cursor ? 'Last' : 'Guide' }], ...(!rpc.params?.cursor || cursorLoop ? { nextCursor: 'page-2' } : {}) }
      else if (rpc.method === 'resources/templates/list') result = { resourceTemplates: [{ uriTemplate: 'fixture://schema/{name}', name: 'Schema' }] }
      else if (rpc.method === 'resources/read') {
        if(rpc.params?.uri === 'fixture://slow') await Bun.sleep(100)
        result = { contents: [{ uri: 'fixture://guide', text: 'Authoritative fixture data', mimeType: 'text/plain' }, ...['first binary','second binary'].map((text,index)=>({uri:`fixture://blob-${index}`,blob:Buffer.from(text).toString('base64'),mimeType:'application/octet-stream'}))] }
      }
      else if (rpc.method === 'prompts/list') result = { prompts: [{ name: 'playbook', arguments: [{ name: 'topic', required: true }] }] }
      else if (rpc.method === 'prompts/get') result = { messages: [{ role: 'user', content: { type: 'text', text: `Playbook: ${rpc.params?.name}` } }] }
      else return Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } })
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
    } })
    const pool = new McpClientPool({ workspaceRootPath: workspace, sessionPath: join(workspace, 'sessions/mcp') })
    let enabled = ['fixture']
    try {
      await pool.connect('fixture', { type: 'http', url: `http://127.0.0.1:${server.port}/mcp` })
      await pool.whenFeaturesProbed('fixture')
      const tools = buildMcpSourceToolCallbacks({ getPool: () => pool, getEnabledSourceSlugs: () => enabled })
      const listing = await tools.listResources('fixture')
      assert.equal(listing.resources.length, 2); assert.equal(listing.resourceTemplates.length, 1)
      assert.equal((await tools.listPrompts('fixture')).prompts[0]?.name, 'playbook')
      assert((await tools.readResource('fixture', 'fixture://guide')).includes('Authoritative fixture data'))
      assert((await tools.getPrompt('fixture', 'playbook', { topic: 'test' })).includes('Playbook: playbook'))
      const saved = readdirSync(join(workspace,'sessions/mcp/downloads'))
      assert.equal(saved.length,2,'Resources arriving in the same second must keep separate files')
      cursorLoop = true
      const bounded = await tools.listResources('fixture'); assert.equal(bounded.truncated,true); assert.equal(bounded.resources.length,2)
      const abort = new AbortController(), timer = setTimeout(()=>abort.abort(),10)
      try { await assert.rejects(tools.readResource('fixture','fixture://slow',{signal:abort.signal}),/abort/i) } finally {clearTimeout(timer)}
      assert.equal(readdirSync(join(workspace,'sessions/mcp/downloads')).length,2,'Cancelled resources must not write files')
      assert.equal(calls.includes('tools/list'), false)
      enabled = []; await assert.rejects(() => tools.readResource('fixture', 'fixture://guide'), /not enabled/)
      enabled = ['fixture']; await pool.disconnect('fixture')
      await assert.rejects(() => tools.readResource('fixture', 'fixture://guide'), /not connected/)
      run.json('mcp-protocol.json', { calls, listing, bounded, saved, resourcesOnly: true })
    } finally { await pool.disconnectAll(); server.stop(true) }
  })
  await check('U15-20-real-shell-output-is-not-delivery-evidence', async () => {
    const { PrerequisiteManager } = await import('../../packages/shared/src/agent/core/prerequisite-manager')
    const guide = join(workspace,'guide.md'), shellPath = guide.replaceAll('\\','/')
    writeFileSync(guide,'GUIDE_CONTENT_015\n')
    const bash = process.platform === 'win32' ? resolve(dirname(Bun.which('git')!), '../bin/bash.exe') : Bun.which('bash')!
    const cases = [
      {command:`echo '${shellPath}'`,read:false}, {command:`grep GUIDE '${shellPath}'`,read:false}, {command:`wc '${shellPath}'`,read:false},
      {command:`cat '${shellPath}' > /dev/null`,read:false}, {command:`true || cat '${shellPath}'`,read:false},
      {command:`cat '${shellPath}'`,read:true}, {command:`head -n 1 '${shellPath}'`,read:true}, {command:`sed -n '1p' '${shellPath}'`,read:true},
    ]
    const report: unknown[] = []
    for (const fixture of cases) {
      const manager = new PrerequisiteManager({workspaceRootPath:workspace}); manager.registerSkillPrerequisites([guide])
      const before = manager.checkBashPrerequisites(fixture.command)
      assert.equal(manager.hasRead(guide),false)
      const child = Bun.spawn([bash,'-c',fixture.command],{stdout:'pipe',stderr:'pipe'})
      const [out,err,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
      assert.equal(code,0,err)
      manager.trackSuccessfulBashRead(fixture.command)
      // Current delivery policy requires native Read version/range evidence.
      // Successful arbitrary shell output must never acknowledge the prerequisite.
      assert.equal(manager.hasRead(guide),false,fixture.command)
      if(fixture.read) { assert(before.allowed); assert(out.includes('GUIDE_CONTENT_015')) }
      report.push({...fixture,before,exitCode:code})
    }
    run.json('guide-reading.json',report)
  })
  await check('U15-07-headless-checkout-path-isolation', async () => {
    const { resolveInheritedAppEnv } = await import('../../packages/server-core/src/runtime/inherited-app-env')
    const foreign = join(workspace,'foreign'), current = join(workspace,'current')
    const env = {PHANERIS_APP_ROOT:foreign,PHANERIS_BUN:join(foreign,'vendor/bun'),PHANERIS_CONFIG_DIR:join(workspace,'user-config'),OTHER_PATH:join(foreign,'data')}
    const source = resolveInheritedAppEnv(env,current,current)
    assert.equal(source.appRootPath,current); assert.deepEqual(source.dropKeys.sort(),['PHANERIS_APP_ROOT','PHANERIS_BUN'])
    assert.equal(resolveInheritedAppEnv(env,null,current).appRootPath,foreign)
    run.json('headless-paths.json',{source,packaged:resolveInheritedAppEnv(env,null,current)})
  })
  await check('U15-26-timezone-and-source-error-status', async () => {
    const { computeNextRuns } = await import('../../apps/electron/src/renderer/components/automations/utils')
    const { deriveConnectionStatus } = await import('../../apps/electron/src/renderer/components/ui/source-connection-status')
    const times = ['Asia/Shanghai','America/New_York'].map(zone=>({zone,runs:computeNextRuns('0 9 * * *',2,zone)}))
    for(const {zone,runs} of times) { assert.equal(runs.length,2); for(const date of runs) assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(date),'09') }
    assert.equal(deriveConnectionStatus({config:{connectionStatus:'error' as never}}),'failed')
    assert.equal(deriveConnectionStatus({config:{connectionStatus:'disconnected' as never}}),'failed')
    assert.equal(deriveConnectionStatus({config:{mcp:{transport:'stdio'}}},false),'local_disabled')
    run.json('schedule-status.json',{times})
  })
  run.json('upstream-015-core.json', { checks })
  run.complete(checks.filter(item => item.pass).map(item => item.id), ['Live OAuth/provider APIs', 'Native browser and frontend behaviours are verified in separate workflows', 'Signed release'])
  assert(checks.every(item => item.pass), JSON.stringify(checks.filter(item => !item.pass)))
})
