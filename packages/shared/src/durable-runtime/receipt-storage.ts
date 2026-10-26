import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DurableModelOutcomeRequest, DurableToolOutcomeRequest } from './types.ts'
import { canonicalJson } from './identity.ts'
import { redactDurablePayload } from './redact.ts'

export type PendingRuntimeReceipt = { kind: 'tool'; request: DurableToolOutcomeRequest } | { kind: 'model'; request: DurableModelOutcomeRequest }
export const runtimeReceiptDirectory = (workspace: string) => join(workspace, 'runtime', 'pending-receipts')

/** Observed data only. Neither writer nor reader may replay a business action. */
export function retainRuntimeReceipt(workspace: string, receipt: PendingRuntimeReceipt): void {
  const directory = runtimeReceiptDirectory(workspace)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const identity = createHash('sha256').update(JSON.stringify([receipt.kind, receipt.request.operationId])).digest('hex')
  const request = { ...receipt.request } as Record<string, unknown>
  delete request.type; delete request.requestId
  const destination = join(directory, `${identity}.json`), content = canonicalJson(redactDurablePayload({ kind: receipt.kind, request }))
  if (existsSync(destination)) {
    if (readFileSync(destination, 'utf8') !== content) throw new Error('A different known result already exists for this operation')
    return
  }
  const temporary = `${destination}.${process.pid}.tmp`
  writeFileSync(temporary, content, { mode: 0o600, flush: true })
  renameSync(temporary, destination)
}
