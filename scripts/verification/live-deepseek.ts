/** Explicitly authorized fixture-only benchmark. Importing never makes a paid request. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import electronPath from 'electron'
import { getLlmConnections } from '../../packages/shared/src/config/storage'
import { getCredentialManager, setCredentialKeyProvider } from '../../packages/shared/src/credentials'
import { CONFIG_DIR, CREDENTIALS_KEY_FILE } from '../../packages/shared/src/config/paths'
import { PRODUCT_NAME, USER_DATA_DIR_NAME } from '../../packages/shared/src/identity.generated'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

export const liveOutput = resolve(import.meta.dir, '../../.cache/capability-integration')
const ledgerPath = resolve(liveOutput, 'live-deepseek-budget.json')
// Conservative peak catalog prices, independently checked against the official pricing page.
const price = { input: .3, output: 1.2, cacheRead: .006 }
export async function liveDeepSeek() {
  mkdirSync(liveOutput, { recursive: true })
  const connection = getLlmConnections().find(c => c.name.toLowerCase() === 'deepseek' && c.defaultModel === 'deepseek-flash')
  if (!connection) throw new Error('Configured DeepSeek Flash connection is unavailable')
  const endpoint = new URL(connection.baseUrl ?? 'https://api.deepseek.com')
  if (endpoint.origin !== 'https://api.deepseek.com') throw new Error('Live fixture benchmark requires the configured official DeepSeek endpoint')
  if (existsSync(CREDENTIALS_KEY_FILE)) {
    // Use the same OS backend as the desktop app. IPC is captured privately;
    // neither the key nor credential is written to an artifact or tool output.
    const scratch = mkdtempSync(resolve(tmpdir(), 'phaneris-key-reader-'))
    const userData = process.env.PHANERIS_CONFIG_DIR?.trim() ? resolve(CONFIG_DIR, 'user-data') : resolve(process.env.APPDATA!, USER_DATA_DIR_NAME)
    const localState = resolve(userData, 'Local State')
    if (existsSync(localState)) copyFileSync(localState, resolve(scratch, 'Local State'))
    const helper = resolve(scratch, 'reader.cjs')
    writeFileSync(helper, `let stage='load';try {const {app,safeStorage}=require('electron');
const fs=require('fs');stage='paths';app.setName(${JSON.stringify(PRODUCT_NAME)});app.setPath('userData',process.argv[3]);app.disableHardwareAcceleration();
app.whenReady().then(()=>{stage='os_check';if(!safeStorage.isEncryptionAvailable())throw Error('OS backend unavailable');stage='decrypt';
const key=safeStorage.decryptString(Buffer.from(fs.readFileSync(process.argv[2],'utf8').trim(),'base64'));
stage='emit';process.stdout.write(JSON.stringify({key}));app.quit();}).catch(()=>{process.stderr.write('KEY_READER_STAGE:'+stage);process.exit(1)});
}catch{process.stderr.write('KEY_READER_STAGE:'+stage);process.exit(1)}`)
    const readerEnv = { ...process.env }; delete readerEnv.ELECTRON_RUN_AS_NODE; delete readerEnv.NODE_OPTIONS
    const child = spawn(electronPath as unknown as string, [helper, CREDENTIALS_KEY_FILE, scratch], { cwd: scratch, env: readerEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let privateOutput = ''; child.stdout.on('data', chunk => { privateOutput += chunk.toString() })
    let readerStage = 'startup'; child.stderr.on('data', chunk => { const match = chunk.toString().match(/KEY_READER_STAGE:(\w+)/); if (match) readerStage = match[1] })
    const status = await new Promise<number | null>((finish, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('OS credential reader timed out')) }, 20_000)
      child.on('exit', code => { clearTimeout(timer); finish(code) })
      child.on('error', () => { clearTimeout(timer); reject(new Error('OS credential reader could not start')) })
    })
    const outputBytes = privateOutput.length
    let key: string | undefined
    try { key = privateOutput.split('\n').map(line => { try { return JSON.parse(line).key } catch { return undefined } }).find(value => /^[0-9a-f]{64}$/i.test(value ?? '')) } finally { privateOutput = '' }
    if (status !== 0 || !key) throw new Error(`OS-protected credential reader unavailable (${readerStage}, exit ${status}, IPC bytes ${outputBytes}); original files preserved`)
    const bytes = Buffer.from(key, 'hex'); key = undefined
    setCredentialKeyProvider({ id: 'verification:electron-safeStorage', getKey: () => bytes })
  }
  const apiKey = await getCredentialManager().getLlmApiKey(connection.slug)
  if (!apiKey) throw new Error('Configured DeepSeek credential is unavailable')
  const catalog = getBuiltinModels('deepseek').find(m => m.id === 'deepseek-flash')!
  const ledger: any = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {
    authorizedModel: 'deepseek-flash', maxRequests: 16, estimatedBudgetUsd: .10, pricePerMillion: price,
    priceSource: 'https://api-docs.deepseek.com/quick_start/pricing/',
    costBasis: 'Conservative peak catalog estimate; provider token usage, no account billing claim', requests: [],
  }
  const save = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
  return { connection: { slug: connection.slug, model: catalog.id, endpoint: endpoint.origin }, catalog, ledger,
    async request(input: any, tag: string, maxOutput = 1200) {
      const body = { ...input, model: catalog.id, max_tokens: Math.min(input.max_tokens ?? maxOutput, maxOutput),
        thinking: { type: 'disabled' }, ...(input.stream ? { stream_options: { include_usage: true } } : {}) }
      delete body.max_completion_tokens
      // UTF-8 bytes are a deliberately conservative reservation, not a token measurement.
      const bytes = Buffer.byteLength(JSON.stringify(body)), reservation = (bytes * price.input + body.max_tokens * price.output) / 1e6
      const spent = ledger.requests.reduce((sum: number, r: any) => sum + (r.estimatedCostUsd ?? r.reservationUsd), 0)
      if (ledger.requests.length >= 16 || spent + reservation > .10) throw new Error('Authorized live benchmark request or estimated cost limit reached')
      const record: any = { number: ledger.requests.length + 1, tag, startedAt: new Date().toISOString(), reservationUsd: reservation,
        requestBytes: bytes, schemaBytes: Buffer.byteLength(JSON.stringify(body.tools ?? [])), requestedModel: body.model, thinking: 'disabled' }
      ledger.requests.push(record); save()
      const started = performance.now()
      let response: Response
      try {
        response = await fetch(new URL('/chat/completions', endpoint), { method: 'POST', headers: {
          authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      } catch {
        record.status = 'network_failed'; record.costStatus = 'unknown'; save()
        throw new Error('Live provider request failed; undisclosed cost retained as reserved')
      }
      record.httpStatus = response.status
      if (!response.ok) {
        record.status = 'http_failed'; record.costStatus = 'unknown'; save()
        // Do not write provider error bodies, which can echo credentials or input.
        return Response.json({ error: { message: `Live fixture provider HTTP ${response.status}` } }, { status: response.status })
      }
      const observe = (chunk: any) => {
        if (chunk.model) record.responseModel = chunk.model
        if (!chunk.usage) return
        record.usage = chunk.usage
        const inputTokens = chunk.usage.prompt_tokens ?? 0, outputTokens = chunk.usage.completion_tokens ?? 0
        const cache = chunk.usage.prompt_cache_hit_tokens ?? chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
        record.estimatedCostUsd = ((inputTokens - cache) * price.input + cache * price.cacheRead + outputTokens * price.output) / 1e6
        record.costStatus = 'estimated'
      }
      if (!body.stream) {
        const result = await response.json(); observe(result)
        record.status = 'completed'; record.elapsedMs = performance.now() - started
        record.costStatus ??= 'unknown'; save(); return Response.json(result)
      }
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let pending = ''
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read()
            if (result.done) { record.status = 'completed'; record.elapsedMs = performance.now() - started; record.costStatus ??= 'unknown'; save(); controller.close(); return }
            pending += decoder.decode(result.value, { stream: true })
            const lines = pending.split('\n'); pending = lines.pop()!
            for (const line of lines) if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try { observe(JSON.parse(line.slice(6))) } catch { /* Ignore only incomplete/non-JSON envelopes. */ }
            }
            controller.enqueue(result.value)
          } catch { record.status = 'stream_failed'; record.costStatus ??= 'unknown'; save(); controller.error(new Error('Live provider stream failed')) }
        },
        async cancel() { record.status = 'cancelled'; record.costStatus ??= 'unknown'; save(); await reader.cancel() },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    },
  }
}
