import type { SessionEvent } from '@phaneris/shared/protocol'

export type ThinkingDelta = { blockIndex: number; complete?: boolean }
interface Pending { delta: string; turnId?: string; thinking?: ThinkingDelta; workspaceId: string }

/** One bounded-rate stream per session; channel changes flush in model order. */
export class SessionDeltaBatcher {
  private readonly pending = new Map<string, Pending>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(private readonly send: (event: SessionEvent, workspaceId: string) => void) {}
  queue(sessionId: string, workspaceId: string, delta: string, turnId?: string, thinking?: ThinkingDelta): void {
    let current = this.pending.get(sessionId)
    if (current && (current.turnId !== turnId || !!current.thinking !== !!thinking || current.thinking?.blockIndex !== thinking?.blockIndex)) {
      this.flush(sessionId); current = undefined
    }
    if (current) { current.delta += delta; current.thinking = thinking }
    else this.pending.set(sessionId, { delta, turnId, thinking, workspaceId })
    if (!this.timers.has(sessionId)) this.timers.set(sessionId, setTimeout(() => this.flush(sessionId), 50))
  }
  flush(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    this.clear(sessionId)
    if (!pending || (!pending.delta && !pending.thinking?.complete)) return
    this.send(pending.thinking ? { type: 'thinking_delta', sessionId, delta: pending.delta, turnId: pending.turnId!, ...pending.thinking }
      : { type: 'text_delta', sessionId, delta: pending.delta, turnId: pending.turnId }, pending.workspaceId)
  }
  discard(sessionId: string, turnId: string): void { if (this.pending.get(sessionId)?.turnId === turnId) this.clear(sessionId) }
  clear(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId)); this.timers.delete(sessionId); this.pending.delete(sessionId)
  }
  dispose(): void { for (const id of this.timers.keys()) this.clear(id) }
}
