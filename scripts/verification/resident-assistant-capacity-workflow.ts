import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { createResidentTaskHost, taskModelResponse } from './fixtures/resident-task-host'

/**
 * Scheduling capacity, in its own process.
 *
 * A workspace declares no ceiling by default: the assistant admits every dispatch
 * the real constraints allow (file scopes, Session availability, configuration)
 * instead of refusing work because four slots are busy. A workspace that wants a
 * ceiling sets `assistantTasks.concurrency`, which stays honoured exactly.
 *
 * This is a separate workflow because the server keeps one assistant service per
 * workspace id, so two fixtures in one process would share the first one's
 * configuration — the second half of this file would silently test the first.
 */
await verificationWorkflow('resident-assistant-capacity', async run => {
  const scenes: string[] = []

  // ── 1 · No declared ceiling admits more than four concurrent Workers ──────
  const uncapped = await createResidentTaskHost(run.directory, async body => {
    const main = JSON.stringify(body.messages).includes('resident_assistant_role')
    return taskModelResponse(body, main ? 'CAPACITY_ACK' : 'CAPACITY_RESULT')
  })
  try {
    const admitted = []
    for (let n = 0; n < 6; n++) admitted.push(await uncapped.dispatch(`RUN_UNCAP${n}`))
    const page = await uncapped.page()
    assert.equal(page.scheduling?.capacity, null, 'no declared ceiling must be published as null, not a number')
    const refused = (await Promise.all(admitted.map(item => uncapped.work(item.id))))
      .filter(item => item.waitingFor?.reason === 'capacity')
    assert.equal(refused.length, 0, `no dispatch may wait for a capacity slot the workspace never declared, saw ${refused.length}`)
    const busy = page.items.filter(item => ['submitting', 'submitted'].includes(String(item.state))).length
    assert(busy > 4, `more than four Workers must be able to run at once, saw ${busy}`)
    run.json('uncapped-evidence.json', { capacity: page.scheduling?.capacity, admitted: admitted.length, concurrent: busy })
    await Promise.all(admitted.map(item => uncapped.cancel(item.id).catch(() => {})))
    scenes.push('CAP01-no-declared-ceiling-runs-more-than-four-workers-at-once')
  } finally { await uncapped.close() }

  run.complete(scenes, ['A workspace that does declare a ceiling keeps waiting for a slot (TM11 covers that in isolation)'])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
