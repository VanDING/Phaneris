import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { retainRuntimeReceipt, runtimeReceiptDirectory, type PendingRuntimeReceipt } from '@phaneris/shared/durable-runtime/receipt-storage'

type Receipt = PendingRuntimeReceipt
/** Retry only observed facts. This journal can never invoke a tool/provider. */
export class RuntimeReceiptJournal {
  private readonly workspaces = new Set<string>()
  private readonly flushing = new Map<string, Promise<void>>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private retryDelay = 2000
  constructor(private readonly commit: (workspace: string, receipt: Receipt) => Promise<unknown>,
    private readonly report: (error: unknown) => void = () => undefined) {}

  private directory(workspace: string) { return runtimeReceiptDirectory(workspace) }
  private files(workspace: string): string[] {
    const directory = this.directory(workspace)
    return existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => join(directory, name)) : []
  }
  pending(workspace: string, sessionId?: string, runId?: string): boolean {
    try { return this.files(workspace).some(path => {
      try { const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
        return (!sessionId || receipt.request.sessionId === sessionId) && (!runId || receipt.request.runOperationId === runId)
      } catch { return true }
    }) } catch (error) { this.report(error); return true }
  }
  consumedInputIds(workspace: string, sessionId: string): string[] {
    let files: string[]
    try { files = this.files(workspace) } catch (error) { this.report(error); return [] }
    return files.flatMap(path => {
      try {
        const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
        return receipt.kind === 'model' && receipt.request.sessionId === sessionId && !['error', 'aborted'].includes(receipt.request.stopReason)
          ? receipt.request.consumedInputIds ?? [] : []
      } catch { return [] }
    })
  }
  retain(workspace: string, receipt: Receipt): void {
    retainRuntimeReceipt(workspace, receipt)
    this.watch(workspace)
  }
  watch(workspace: string): void {
    this.workspaces.add(workspace)
    if (this.closed || this.timer || !this.pending(workspace)) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void Promise.allSettled([...this.workspaces].map(root => this.flush(root))).then(() => {
        const remaining = [...this.workspaces].find(root => this.pending(root))
        if (remaining && !this.closed) { this.retryDelay = Math.min(60_000, this.retryDelay * 2); this.watch(remaining) }
        else this.retryDelay = 2000
      })
    }, this.retryDelay)
    this.timer.unref()
  }
  flush(workspace: string): Promise<void> {
    const active = this.flushing.get(workspace)
    if (active) return active
    const pending = (async () => {
      let paths: string[]
      try { paths = this.files(workspace) } catch (error) { this.report(error); return }
      for (const path of paths) {
        try {
          const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
          if (!['tool', 'model'].includes(receipt.kind) || !receipt.request?.operationId) throw new Error('Invalid retained outcome receipt')
          await this.commit(workspace, receipt)
          unlinkSync(path)
        } catch (error) { this.report(error) }
      }
    })().finally(() => { this.flushing.delete(workspace) })
    this.flushing.set(workspace, pending)
    return pending
  }
  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    await Promise.allSettled([...this.workspaces].map(root => this.flush(root)))
  }
}
