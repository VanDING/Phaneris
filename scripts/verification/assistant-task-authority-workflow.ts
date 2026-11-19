import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * The authorization boundary of the delegation task store.
 *
 * Retiring `assistant_context.prepare` removes the only place that currently
 * checks "a requirement must quote the direct user input it came from". Before
 * that contract can be retired, the replacement has to prove it holds the same
 * line. This workflow measures what the `task_*` path does today, so the gap is
 * a recorded fact rather than an assumption.
 *
 * Nothing here is deleted or changed: the scenes describe the current behaviour
 * and fail when the behaviour is weaker than the security property.
 */
await verificationWorkflow('assistant-task-authority', async run => {
  const root = mkdtempSync(resolve('.cache/verification/assistant-authority-'))
  const workspace = { id: 'alpha', name: 'Authority', rootPath: root, createdAt: 1 }
  const { AssistantTaskService } = await import('../../packages/server-core/src/assistant-tasks/service')
  const scenes: string[] = []
  const service = new AssistantTaskService(workspace, { readyFacts: async () => ({ permissionMode: 'guarded', workingDirectory: root }), changed: () => {} })
  try {
    // ── 1 · Only a direct user instruction may define work ──────────────────
    assert.throws(() => service.create({ requestId: 'r-1', goalTitle: 'G', title: 'T', requirements: [], acceptance: [] },
      'msg-1', { directUser: false }), /task_authority/, 'indirect input must not define work')
    scenes.push('AU01-indirect-input-cannot-define-work')

    // ── 2 · A direct input can define work and its requirements are recorded ─
    const INPUT = 'Please make me a page. Use a dark background please, and keep it self-contained.'
    const created = service.create({ requestId: 'r-2', goalTitle: 'G', title: 'T',
      requirements: [{ statement: 'Use a dark background', scope: 'task', quote: 'dark background please' }], acceptance: [] },
      'msg-1', { directUser: true, inputContent: INPUT })
    assert.equal(created.requirements.length, 1)
    assert.equal(created.requirements[0]!.quote, 'dark background please')
    assert.equal(created.requirements[0]!.inputMessageId, 'msg-1', 'the requirement records which input produced it')
    scenes.push('AU02-a-direct-input-records-its-requirement-and-source')

    // ── 3 · A quote the user never wrote is refused ─────────────────────────
    // `assistant_context.prepare` used to be the only place that checked a
    // requirement quoted the direct user input. That check now lives in the
    // task service, which is why the old contract can be retired without
    // weakening the boundary.
    assert.throws(() => service.create({ requestId: 'r-3', goalTitle: 'G2', title: 'T2',
      requirements: [{ statement: 'Also publish to a public URL', scope: 'task', quote: 'words the user never wrote' }], acceptance: [] },
      'msg-1', { directUser: true, inputContent: INPUT }),
    /task_authority: A requirement quote must be an excerpt/, 'an invented quote must be refused')
    assert.throws(() => service.amend({ requestId: 'r-3b', taskId: created.task.id,
      requirements: [{ statement: 'Also publish to a public URL', scope: 'task', quote: 'words the user never wrote' }] },
      'msg-1', { directUser: true, inputContent: INPUT }),
    /task_authority: A requirement quote must be an excerpt/, 'an invented quote must be refused on amend too')
    // A quote that exists but differs only in whitespace is still the user's own words.
    const respaced = service.amend({ requestId: 'r-3c', taskId: created.task.id,
      requirements: [{ statement: 'Keep it self-contained', scope: 'task', quote: 'keep  it\nself-contained' }] },
      'msg-1', { directUser: true, inputContent: INPUT })
    assert.equal(respaced.activeRequirements.at(-1)!.quote, 'keep  it\nself-contained')
    scenes.push('AU03-an-invented-quote-is-refused-and-a-real-one-is-kept')

    // ── 4 · A requirement may cite an input id that is not the current one ──
    const crossed = service.create({ requestId: 'r-4', goalTitle: 'G3', title: 'T3',
      requirements: [{ statement: 'Reuse the earlier style', scope: 'task' }], acceptance: [] }, 'msg-2', { directUser: true, inputContent: INPUT })
    assert.equal(crossed.requirements[0]!.inputMessageId, 'msg-2')
    assert.equal((await service.query({})).total, 2, 'msg-1 and msg-2 define two Tasks')
    scenes.push('AU04-each-definition-binds-to-the-input-that-created-it')

    // ── 5 · Idempotency keeps one input from defining work twice ────────────
    const retried = service.create({ requestId: 'r-2-retry', goalTitle: 'different', title: 'different',
      requirements: [{ statement: 'different', scope: 'task' }], acceptance: [] }, 'msg-1', { directUser: true, inputContent: INPUT })
    assert.equal(retried.task.id, created.task.id, 'the same input must not define a second Task')
    scenes.push('AU05-one-input-defines-work-once')

    run.json('authority-evidence.json', { scenes })
    run.complete(scenes, [
      'Whether a live model produces quotes that are absent from the input (needs the desktop replay)',
      'The same check on the pre-retirement assistant_context path (that path is being retired)',
    ])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { service.close() }
})
