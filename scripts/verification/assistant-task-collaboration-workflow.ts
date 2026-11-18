import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Stage 4 acceptance: long-running collaboration.
 *
 * One pre-meeting briefing is three separately acceptable facts — the meeting and
 * mail were read, a local draft exists, and sending it is pending a decision that
 * binds the exact attachment version. Changing the attachment or revoking the
 * mandate makes the old approval unusable rather than silently authorizing new
 * content. There is no real outbound effect in this workflow; the external send
 * channel is represented, not exercised.
 *
 * Failure conditions are M24-M28 in
 * docs/verification/assistant-refactor-2026-11-18-failure-matrix.md.
 */
await verificationWorkflow('assistant-task-collaboration', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const root = mkdtempSync(resolve('.cache/verification/assistant-collab-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  process.env.NODE_ENV = 'test'
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  const { AssistantTaskStore } = await import('../../packages/server-core/src/assistant-tasks/store')
  const { approvalUsable, mandateInForce } = await import('../../packages/server-core/src/assistant-tasks/authority')
  const workspace = { id: 'briefing', rootPath: workspaceRoot }
  const store = new AssistantTaskStore(workspace)
  const scenes: string[] = [], evidence: unknown[] = []
  try {
    // M24 · Standing read authority is recorded with the statement that granted it.
    const readCalendar = store.grantMandate({ requestId: 'man-cal', action: 'read', target: 'calendar:primary', scope: 'standing',
      quote: '读我的日历和邮件，会前给我准备简报' }, 'msg-grant')
    const readMail = store.grantMandate({ requestId: 'man-mail', action: 'read', target: 'mail:inbox', scope: 'standing',
      quote: '读我的日历和邮件，会前给我准备简报' }, 'msg-grant')
    assert.equal(readCalendar.quote, '读我的日历和邮件，会前给我准备简报')
    assert.equal(mandateInForce(store.mandates(), 'read', 'calendar:primary', Date.now())?.id, readCalendar.id)
    assert.equal(mandateInForce(store.mandates(), 'read', 'mail:inbox', Date.now())?.id, readMail.id)
    // Reading is authorized; sending to an external recipient is not.
    assert.equal(mandateInForce(store.mandates(), 'send', 'mail:external', Date.now()), undefined)
    scenes.push('L01-read-authority-recorded-with-its-source')

    // The briefing is recorded as one Task whose parts stay separately acceptable.
    const task = store.create({ requestId: 'collab-briefing', goalTitle: '会前简报', title: '周三会前简报',
      scopeIn: ['读取会议与相关邮件', '生成本地简报草稿', '外发需事先审批'], scopeOut: ['未经批准的外发'],
      requirements: [{ statement: '只读日历与邮件，不修改邀请', scope: 'task', quote: '读我的日历和邮件，会前给我准备简报' },
        { statement: '草稿写本地，外发单独审批', scope: 'task' }],
      acceptance: ['简报覆盖会议时间与参会人', '草稿文件存在', '外发绑定附件版本并获批准'] }, 'msg-brief')
    assert.equal(task.activeRequirements.length, 2)
    scenes.push('L02-briefing-is-one-task-with-separate-acceptable-parts')

    // M24 · A draft is produced and approved locally without any send approval.
    const draft = { artifactId: 'artifact-briefing', revision: 'a'.repeat(64) }
    const sendEffect = { target: 'mail:external', channel: 'mail', recipients: ['boss@example.com'], artifact: draft, digest: 'digest-v1' }
    const decided = store.recordApproval({ requestId: 'apr-send-1', mandateId: readCalendar.id, action: 'send', effect: sendEffect,
      decision: 'approved', reason: 'User approved the exact recipient and attachment version' })
    assert.equal(decided.decision, 'approved')
    assert(approvalUsable(decided, sendEffect).usable)
    scenes.push('L03-approval-binds-recipient-channel-and-attachment-version')

    // M25 · A changed attachment version makes the old approval unusable.
    const newerDraft = { ...draft, revision: 'b'.repeat(64) }
    const newer = approvalUsable(decided, { ...sendEffect, artifact: newerDraft })
    assert.equal(newer.usable, false)
    assert.match(newer.reason ?? '', /version changed/)
    const changedRecipients = approvalUsable(decided, { ...sendEffect, recipients: ['boss@example.com', 'audit@example.com'] })
    assert.equal(changedRecipients.usable, false)
    assert.match(changedRecipients.reason ?? '', /recipients changed/)
    const changedChannel = approvalUsable(decided, { ...sendEffect, channel: 'messaging' })
    assert.equal(changedChannel.usable, false)
    evidence.push({ newer, changedRecipients, changedChannel })
    scenes.push('L04-attachment-or-recipient-change-invalidates-approval')

    // M25 · A new decision on the same target retires the earlier approval.
    const reDecided = store.recordApproval({ requestId: 'apr-send-2', mandateId: readCalendar.id, action: 'send',
      effect: { ...sendEffect, artifact: newerDraft, digest: 'digest-v2' }, decision: 'approved' })
    const stale = store.approvals().find(item => item.id === decided.id)!
    assert(stale.invalidatedAt, 'The earlier approval must be marked stale')
    assert.equal(approvalUsable(stale, sendEffect).usable, false)
    assert(approvalUsable(reDecided, { ...sendEffect, artifact: newerDraft, digest: 'digest-v2' }).usable)
    scenes.push('L05-newer-decision-retires-the-earlier-approval')

    // M26 · Revoking the mandate stops reopening the effect.
    const revoked = store.revokeMandate(readMail.id, '撤权')
    assert(revoked.revokedAt)
    assert.equal(mandateInForce(store.mandates(), 'read', 'mail:inbox', Date.now()), undefined)
    assert.equal(mandateInForce(store.mandates(), 'read', 'calendar:primary', Date.now())?.id, readCalendar.id,
      'Revoking one mandate must not revoke an unrelated one')
    scenes.push('L06-revocation-is-scoped-and-immediate')

    // M26 · An expired mandate is out of force without being revoked.
    const expiring = store.grantMandate({ requestId: 'man-exp', action: 'read', target: 'mail:archive', scope: 'standing',
      quote: '只读最近一周的归档', expiresAt: Date.now() + 50 }, 'msg-grant-2')
    assert(mandateInForce(store.mandates(), 'read', 'mail:archive', Date.now())?.id, expiring.id)
    assert.equal(mandateInForce(store.mandates(), 'read', 'mail:archive', Date.now() + 10_000), undefined)
    scenes.push('L07-expiry-ends-force-without-a-revocation-record')

    // M27 · A repeated trusted request is idempotent, not a second approval.
    const repeated = store.grantMandate({ requestId: 'man-cal', action: 'read', target: 'calendar:primary', scope: 'standing' }, 'msg-grant')
    assert.equal(repeated.id, readCalendar.id)
    assert.equal(store.mandates().filter(item => item.target === 'calendar:primary').length, 1)
    scenes.push('L08-repeated-grant-is-idempotent')

    // M28 · A rejected effect stays rejected even if the caller reuses its digest.
    const rejected = store.recordApproval({ requestId: 'apr-send-3', action: 'send', effect: { ...sendEffect, artifact: newerDraft, digest: 'digest-v3' },
      decision: 'rejected', reason: '不要发给外部' })
    assert.equal(approvalUsable(rejected, { ...sendEffect, artifact: newerDraft, digest: 'digest-v3' }).usable, false)
    assert.match(approvalUsable(rejected, { ...sendEffect, artifact: newerDraft, digest: 'digest-v3' }).reason ?? '', /rejected/)
    scenes.push('L09-rejected-effect-cannot-be-reused')
  } finally { store.close() }

  const reopened = new AssistantTaskStore(workspace)
  try {
    assert.equal(reopened.mandates().length, 3, 'Mandates must survive a reopen')
    assert.equal(reopened.approvals().length, 3, 'Approvals must survive a reopen')
    assert(reopened.approvals().some(item => item.invalidatedAt), 'Invalidation must persist, not be recomputed')
    run.json('collaboration-state.json', { scenes, evidence,
      mandates: reopened.mandates().map(item => ({ id: item.id, action: item.action, target: item.target, revoked: !!item.revokedAt })),
      approvals: reopened.approvals().map(item => ({ id: item.id, decision: item.decision, digest: item.effect.digest, invalidated: !!item.invalidatedAt })) })
    scenes.push('L10-authority-and-approvals-survive-a-reopen')
  } finally { reopened.close() }

  run.complete(scenes, ['Real outbound send to an external provider', 'Live calendar/mail connector reads', 'Electron approval-card rendering'])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
