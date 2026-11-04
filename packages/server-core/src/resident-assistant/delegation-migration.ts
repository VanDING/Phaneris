import type { SqliteDatabase } from '../runtime/sqlite'
import type { AssistantDispatch, AssistantDelegationReceipt, EffectiveWorkerConfig } from '@phaneris/session-tools-core/delegation-contracts'

export interface LegacyDelegation {
  id: string; workspaceId: string; assistantSessionId: string; originMessageId: string
  request: AssistantDispatch; effectiveConfig: EffectiveWorkerConfig; adjustments: string[]
  state: string; workerSessionId?: string; inputMessageId?: string; createdAt: number; updatedAt: number; seq: number
  result?: { text: string; truncated: boolean; sessionId: string; messageId: string }; error?: string
}

/** Only run while upgrading the pre-release full-record format. */
export async function migrateDelegations(db: SqliteDatabase, workspaceId: string,
  importLegacy: (legacy: LegacyDelegation) => Promise<{ sessionId: string; inputMessageId: string }>,
  save: (receipt: AssistantDelegationReceipt) => unknown): Promise<void> {
  const rows = db.prepare("SELECT body,fingerprint FROM work WHERE json_extract(body,'$.formatVersion') IS NOT 2 ORDER BY seq").all() as Array<{ body: string; fingerprint: string }>
  for (const row of rows) {
    const legacy = JSON.parse(row.body) as LegacyDelegation
    // Preserve the exact old record before changing ownership. This archive is
    // never read as active task state or exposed through assistant tools.
    db.prepare('INSERT OR IGNORE INTO legacy_work_archive VALUES (?,?)').run(legacy.id, row.body)
    const receipt: AssistantDelegationReceipt = {
      formatVersion: 2, id: legacy.id, workspaceId, assistantSessionId: legacy.assistantSessionId,
      originMessageId: legacy.originMessageId, requestId: legacy.request.requestId, fingerprint: row.fingerprint,
      sessionId: legacy.workerSessionId, inputMessageId: legacy.inputMessageId,
      state: ['accepted','result_ready','failed','cancelled'].includes(legacy.state) ? legacy.state as AssistantDelegationReceipt['state'] : 'needs_attention',
      createdAt: legacy.createdAt, updatedAt: legacy.updatedAt, seq: legacy.seq, error: legacy.error,
      result: legacy.result ? { sessionId: legacy.result.sessionId, messageId: legacy.result.messageId } : undefined,
    }
    try {
      Object.assign(receipt, await importLegacy(legacy))
    } catch (error) {
      receipt.state = 'needs_attention'
      receipt.error = `Legacy assignment requires recovery; its original record is archived: ${error instanceof Error ? error.message : String(error)}`
    }
    save(receipt)
  }
  db.exec('PRAGMA user_version=2')
}
