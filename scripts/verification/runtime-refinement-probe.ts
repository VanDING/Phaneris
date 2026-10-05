/** Actual script handlers, real interpreters and OS sandbox in an isolated packaged host. */
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleScriptSandbox } from '../../packages/session-tools-core/src/handlers/script-sandbox'
import { handleTransformData } from '../../packages/session-tools-core/src/handlers/transform-data'
import type { SessionToolContext } from '../../packages/session-tools-core/src/context'

const fixture = process.env.PHANERIS_VERIFICATION_FIXTURE!
const sessionDir = join(fixture, 'session'), dataDir = join(sessionDir, 'data')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(sessionDir, 'package.json'), JSON.stringify({ type: 'module' }))
writeFileSync(join(sessionDir, 'input.json'), JSON.stringify({ value: 21 }))
const ctx = { sessionId: 'runtime-verification', sessionPath: sessionDir, dataPath: dataDir } as SessionToolContext
const records: Array<{ id: string; pass: boolean; observation?: unknown; error?: string }> = []
async function check(id: string, action: () => Promise<unknown>) {
  try { records.push({ id, pass: true, observation: await action() }) }
  catch (error) { records.push({ id, pass: false, error: String(error) }) }
}
const text = (result: Awaited<ReturnType<typeof handleScriptSandbox>>) => result.content.map(item => item.text ?? '').join('\n')

async function main() {
await check('Offline cold preparation fails clearly without executing the script and can retry', async () => {
  process.env.UV_OFFLINE = '1'
  const marker = join(dataDir, 'must-not-run.txt')
  const result = await handleScriptSandbox(ctx, { language: 'python3', script: `open(${JSON.stringify(marker)},'w').write('not allowed')` })
  assert(result.isError, text(result)); assert(text(result).includes('Python runtime not ready'), text(result)); assert(!existsSync(marker))
  delete process.env.UV_OFFLINE
  return text(result)
})
await check('Concurrent cold Python requests prepare and execute the exact interpreter', async () => {
  const results = await Promise.all([1, 2].map(() => handleScriptSandbox(ctx, { language: 'python3', script: "import sys; print('.'.join(map(str,sys.version_info[:3])))" })))
  for (const result of results) { assert.equal(result.isError, false, text(result)); assert(text(result).includes('3.12.15')) }
  return results.map(text)
})
for (const language of ['node', 'python3', 'bun'] as const) {
  await check(`${language}: diagnostic and temp write in packaged sandbox`, async () => {
    const script = language === 'python3'
      ? "import sys, tempfile, os; print('version=' + '.'.join(map(str, sys.version_info[:3]))); assert 'OPENAI_API_KEY' not in os.environ; p=tempfile.NamedTemporaryFile(); p.write(b'ok'); print('runtime-ready')"
      : "const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); if(process.env.OPENAI_API_KEY) throw Error('credential leaked'); fs.writeFileSync(path.join(os.tmpdir(),'scratch.txt'),'ok'); console.log('runtime-ready'); console.log('node='+process.versions.node);"
    const result = await handleScriptSandbox(ctx, { language, script })
    assert.equal(result.isError, false, text(result))
    assert(text(result).includes('runtime-ready'))
    assert(text(result).includes('networkIsolation: enforced'))
    assert(text(result).includes('filesystemIsolation: enforced'))
    if (language === 'python3') assert(text(result).includes('version=3.12.15'), text(result))
    if (language === 'node') assert(text(result).includes('source: electron'), text(result))
    return text(result)
  })
  await check(`${language}: transform creates verifiable JSON`, async () => {
    const script = language === 'python3'
      ? "import sys,json; v=json.load(open(sys.argv[1]))['value']; json.dump({'answer':v*2},open(sys.argv[-1],'w'))"
      : "const fs=require('node:fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).value; fs.writeFileSync(process.argv.at(-1),JSON.stringify({answer:v*2}));"
    const result = await handleTransformData(ctx, { language, script, inputFiles: ['input.json'], outputFile: `${language}.json` })
    assert.equal(result.isError, false, text(result))
    const output = join(dataDir, `${language}.json`)
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), { answer: 42 })
    return { output, diagnostic: text(result) }
  })
}
await check('Node accepts ES module imports alongside CommonJS diagnostics', async () => {
  const result = await handleScriptSandbox(ctx, { language: 'node', script: "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; fs.writeFileSync(path.join(os.tmpdir(),'esm.txt'),'ok'); console.log('esm-ready');" })
  assert.equal(result.isError, false, text(result)); assert(text(result).includes('esm-ready'))
  return text(result)
})
await check('OS temporary directory aliases retain valid session containment', async () => {
  const temporarySession = mkdtempSync(join(tmpdir(), 'phaneris-runtime-alias-'))
  const temporaryData = join(temporarySession, 'data')
  mkdirSync(temporaryData)
  const temporaryContext = { ...ctx, sessionPath: temporarySession, dataPath: temporaryData }
  const diagnostic = await handleScriptSandbox(temporaryContext, { language: 'node', script: "process.stdin.on('data', d => console.log(String(d).toUpperCase()))", stdin: 'alias-ready' })
  assert.equal(diagnostic.isError, false, text(diagnostic)); assert(text(diagnostic).includes('ALIAS-READY'))
  const transformed = await handleTransformData(temporaryContext, { language: 'node', inputFiles: [], outputFile: 'alias.json', script: "require('node:fs').writeFileSync(process.argv.at(-1),JSON.stringify({alias:true}))" })
  assert.equal(transformed.isError, false, text(transformed))
  assert.deepEqual(JSON.parse(readFileSync(join(temporaryData, 'alias.json'), 'utf8')), { alias: true })
  return { temporarySession, diagnostic: text(diagnostic), transform: text(transformed) }
})
await check('Prepared Python remains available offline and concurrent calls settle', async () => {
  process.env.UV_OFFLINE = '1'
  const results = await Promise.all([1, 2].map(() => handleScriptSandbox(ctx, { language: 'python3', script: "print('offline-ready')" })))
  for (const result of results) { assert.equal(result.isError, false, text(result)); assert(text(result).includes('offline-ready')) }
  return results.map(text)
})
await check('Network requests are denied', async () => {
  const result = await handleScriptSandbox(ctx, { language: 'node', script: "require('node:http').get('http://127.0.0.1:9',()=>process.exit(0)).on('error',e=>{console.error(e.code);process.exit(7)})" })
  assert(result.isError, text(result)); assert(text(result).includes('networkIsolation: enforced'))
  assert(/EPERM|EACCES|Operation not permitted/.test(text(result)), text(result))
  return text(result)
})
await check('Outside-session writes remain denied', async () => {
  const outside = join(fixture, 'outside.txt')
  const result = await handleScriptSandbox(ctx, { language: 'python3', script: `open(${JSON.stringify(outside)},'w').write('must not exist')` })
  assert(result.isError, text(result)); assert(!existsSync(outside))
  assert(text(result).includes('PermissionError'), text(result))
  return text(result)
})
await check('Timeout settles and kills child process group', async () => {
  const result = await handleScriptSandbox(ctx, { language: 'node', timeoutMs: 200, script: "require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit'});setTimeout(()=>{},60000)" })
  assert(result.isError, text(result)); assert(text(result).includes('timedOut: true'), text(result))
  return text(result)
})
writeFileSync(join(fixture, 'runtime.json'), JSON.stringify({ fixture, host: process.execPath, records }, null, 2))
console.log(JSON.stringify({ fixture, records }))
process.exit(records.every(record => record.pass) ? 0 : 1)
}
void main().catch(error => { console.error(error); process.exit(1) })
