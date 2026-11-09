import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveDeepSeek } from './live-deepseek'
import { verificationWorkflow } from './verification-artifacts'

// Both main and Worker inference are real. Only synthetic workspaces are sent.
await verificationWorkflow('resident-context-063-live', async run => {
  const scenes: string[] = []
  const modes = process.env.PHANERIS_063_LIVE_MODES?.split(',') ?? ['autonomy', 'worker', 'revision', 'checkpoint']
  assert(modes.every(mode => ['autonomy', 'worker', 'revision', 'checkpoint'].includes(mode)))
  for (const mode of modes) {
    const output = join(run.directory, mode); mkdirSync(output)
    const live = await liveDeepSeek(output), requests: unknown[] = []
    const release = Promise.withResolvers<void>(), reached = Promise.withResolvers<void>()
    const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/release-worker') { release.resolve(); return Response.json({ released: true }) }
      if (path === '/worker-started') { await reached.promise; return Response.json({ reached: true }) }
      const body = await request.json() as any; requests.push(body)
      if (mode === 'worker' && !JSON.stringify(body.messages).includes('resident_assistant_role')) { reached.resolve(); await release.promise }
      try { return await live.request(body, `context-063-${mode}-real-inference`, 1600) }
      catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : 'Live verification failed', type: 'verification_limit' } }, { status: 422 }) }
    } })
    try {
      const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-context-063-live.ts', output, proxy.url.href, live.connection.model, mode], { stdout: 'pipe', stderr: 'pipe' })
      const timer = setTimeout(() => { release.resolve(); child.kill() }, 420000)
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      clearTimeout(timer); writeFileSync(join(output, 'host.log'), out + err)
      assert.equal(code, 0, (out + err).slice(-7000))
      const evidence = JSON.parse(readFileSync(join(output, 'live-evidence.json'), 'utf8'))
      if (mode === 'checkpoint') {
        const receipts = (requests as Array<{ messages?: Array<{ content?: unknown }> }>).flatMap(body => {
          const found: Array<{ operationId: string; action: string; conclusions?: string; branchId?: string; branchIds?: string[] }> = []
          for (const message of body.messages ?? []) {
            const content = typeof message.content === 'string' ? message.content
              : Array.isArray(message.content) ? message.content.map((part: { text?: string }) => part.text ?? '').join('\n') : ''
            const match = content.match(/<resident_context_segment>\s*(\{[\s\S]*?\})\s*<\/resident_context_segment>/)
            if (!match) continue
            try { found.push(...(JSON.parse(match[1]).settledContextActions ?? [])) } catch {}
          }
          return found
        })
        const unique = new Map(receipts.map(action => [action.operationId, action]))
        const settled = [...unique.values()]
        const checkpointReceipt = settled.find(action => action.action === 'checkpoint' && action.conclusions?.includes('两段'))
        assert(checkpointReceipt, 'Checkpoint receipt is missing the corrected requirement')
        assert(settled.some(action => action.action === 'hibernate'), 'Hibernate receipt is missing from the live request')
        const checkpoints = settled.filter(action => action.action === 'checkpoint')
        assert(checkpoints.length === new Set(checkpoints.map(action => action.branchId ?? '__main__')).size, 'Checkpoint must not repeat for the same branch after it succeeds')
        const hibernates = settled.filter(action => action.action === 'hibernate')
        assert(hibernates.length === new Set(hibernates.flatMap(action => action.branchIds ?? [])).size, 'Hibernate must not repeat for the same branch after it succeeds')
        const turns = JSON.parse(readFileSync(join(output, 'turns.json'), 'utf8')) as Array<{ reply?: string }>
        const checkpointReply = turns[2]?.reply ?? ''
        assert(!/没有保存|未保存|没能保存|保存失败/.test(checkpointReply), `Checkpoint reply contradicts the committed checkpoint: ${checkpointReply}`)
        assert(/恢复点|检查点/.test(checkpointReply) && /保存|记录|建立/.test(checkpointReply), `Checkpoint reply must acknowledge the saved checkpoint: ${checkpointReply}`)
      }
      scenes.push(...evidence.scenes)
      run.json('completed-modes.json', { scenes, completed: modes.slice(0, modes.indexOf(mode) + 1) })
      run.json(`${mode}-provider.json`, { ...live.connection, inference: 'Real main assistant and ordinary Worker; no controlled tool decisions or generated replies' })
    } finally { release.resolve(); proxy.stop(true); writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2)) }
  }
  run.complete(scenes, ['Generalization across models and long-term personal workloads', 'Real Work data', 'Signed distribution'])
})
