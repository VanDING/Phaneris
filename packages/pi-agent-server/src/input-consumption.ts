import type { AgentMessage } from '@earendil-works/pi-agent-core'

/** Correlates host input IDs with actual SDK user-message delivery, not receipts
 * for queue admission. A model outcome records which delivered inputs it used. */
export class NativeInputConsumption {
  private waiting: Array<{ id: string; text: string }> = []
  private delivered = new Set<string>()
  register(id: string, text: string): void { this.waiting.push({ id, text }) }
  discard(id: string): void { this.waiting = this.waiting.filter(input => input.id !== id) }
  stamp(message: AgentMessage): void {
    if (message.role !== 'user') return
    const text = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const index = this.waiting.findIndex(input => input.text === text)
    if (index < 0) return
    const [input] = this.waiting.splice(index, 1)
    Object.assign(message, { phanerisInputId: input!.id })
    this.delivered.add(input!.id)
  }
  snapshot(): string[] { return [...this.delivered] }
  consumed(ids: readonly string[]): void { for (const id of ids) this.delivered.delete(id) }
  reset(): void { this.waiting = []; this.delivered.clear() }
}
