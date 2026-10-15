import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upstream-015-browser', async run => {
  const entry = resolve(import.meta.dir, 'fixtures/upstream-015-browser.ts'), bundle = join(run.directory, 'native-browser.cjs')
  const page = await build({ entryPoints: [resolve(import.meta.dir, 'fixtures/upstream-015-controlled.tsx')], bundle: true, platform: 'browser', write: false, minify: true,
    alias: { '@': resolve('apps/electron/src/renderer'), '@config': resolve('packages/shared/src/config') } })
  writeFileSync(join(run.directory, 'page.html'), `<!doctype html><meta charset="utf-8"><title>Native fixture</title><style>body{background:rgb(22,66,111)}main{display:grid;gap:15px;width:500px;background:white;padding:20px}</style><div id="root"></div><script>${page.outputFiles[0]!.text}</script>`)
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, external: ['electron'], logLevel: 'warning' })
  const env: NodeJS.ProcessEnv = { ...process.env, PHANERIS_CONFIG_DIR: join(run.directory, 'profile'), PHANERIS_TELEMETRY_ENABLED: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = (await import('electron')).default as unknown as string
  const child = Bun.spawn([electron, bundle, run.directory], { env, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 120_000)
  let checks: string[] = []
  try {
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'native-process.log'), stdout+stderr)
    const report = JSON.parse(readFileSync(join(run.directory, 'native-browser.json'),'utf8'))
    assert.equal(code,0,JSON.stringify(report)); checks = report.checks
  } finally { clearTimeout(timer) }
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'profile')
  const { createDurableRuntime, canonicalToolArgsHash } = await import('../../packages/server-core/src/durable-runtime')
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const { protectBrowserJournal } = await import('../../packages/pi-agent-server/src/browser-history-privacy')
  const runtime = createDurableRuntime(), workspace = join(run.directory,'durable-workspace')
  const journal = protectBrowserJournal(SessionManager.create(workspace, join(run.directory,'pi-journal')))
  const secret = 'SYNTHETIC_BROWSER_SECRET_015'
  journal.appendMessage({ role: 'user', content: 'Native browser privacy fixture', timestamp: 1 })
  const commands: Array<string|string[]> = [`fill @e1 ${secret}`, ['fill','@e1',secret], `"fill" @e1 "${secret}"`, `click @e1; type ${secret}; paste ${secret}`, ['set-clipboard',secret]]
  try {
    runtime.commands.acceptRun({ workspaceRootPath: workspace, sessionId:'privacy', operationId:'privacy-run', turnId:'turn', userMessageId:'user', userMessage:'Native browser privacy fixture' })
    for (let i=0;i<commands.length;i++) {
      const args = { command: commands[i]! }, exact = JSON.stringify(args)
      const request = { sessionId:'privacy', runOperationId:'privacy-run', toolName:i % 2 ? 'session__browser_tool' : 'mcp__session__browser_tool', providerToolCallId:`call-${i}`, args }
      const prepared = await runtime.effects.prepareTool(workspace,request)
      assert.equal(prepared.canonicalArgsHash,canonicalToolArgsHash(request.toolName,args)); assert.equal(JSON.stringify(args),exact)
      await runtime.effects.commitToolOutcome(workspace,{...request, ...prepared,result:'Filled password field @e1 (synthetic)',isError:false})
      journal.appendMessage({role:'assistant',content:[{type:'toolCall',id:`call-${i}`,name:request.toolName,arguments:args}], api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}, stopReason:'toolUse',timestamp:i+2})
    }
    const model = await runtime.effects.prepareModel(workspace,{sessionId:'privacy',runOperationId:'privacy-run',providerRequestId:'model',provider:'fixture',model:'fixture',canonicalRequestHash:createHash('sha256').update('synthetic').digest('hex')})
    await runtime.effects.commitModelOutcome(workspace,{sessionId:'privacy',runOperationId:'privacy-run',operationId:model.operationId,providerRequestId:'model',provider:'fixture',model:'fixture',canonicalRequestHash:createHash('sha256').update('synthetic').digest('hex'),stopReason:'toolUse',content:[{type:'toolCall',id:'model-call',name:'browser_tool',arguments:{command:['paste',secret]}}]})
    const facts = runtime.queries.events(workspace)
    assert(!JSON.stringify(facts).includes(secret)); assert(!readFileSync(journal.getSessionFile()!,'utf8').includes(secret))
    checks.push('U15-24-durable-tool-and-model-facts-hide-text-before-write','U15-24-sdk-journal-hides-text-with-exact-live-input-and-hash')
    run.json('privacy-facts.json',facts)
  } finally { await runtime.close() }
  run.json('upstream-015-browser.json',{checks,scope:'Windows Electron, actual CDP and controlled React fixture; actual Durable SQLite and Pi SDK journal'})
  run.complete(checks,['Live CAPTCHA/OAuth accounts','Other operating systems','Signed release'])
})
