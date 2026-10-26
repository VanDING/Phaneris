/** Request correlation only. A late/duplicate reply cannot settle a request twice. */
export class PendingReplies<Response> {
  private readonly replies = new Map<string, (response: Response) => void>()

  register(id: string, reply: (response: Response) => void): void {
    if (this.replies.has(id)) throw new Error(`Duplicate pending request: ${id}`)
    this.replies.set(id, reply)
  }

  wait(id: string, unavailable: Response, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = () => finish(unavailable)
      const finish = (response: Response) => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', cancel)
        this.delete(id)
        resolve(response)
      }
      this.register(id, finish)
      if (options.signal?.aborted) { cancel(); return }
      options.signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(cancel, options.timeoutMs ?? 15_000)
    })
  }

  settle(id: string, response: Response): boolean {
    const reply = this.replies.get(id)
    if (!reply) return false
    this.replies.delete(id)
    reply(response)
    return true
  }

  delete(id: string): void { this.replies.delete(id) }

  cancelAll(response: Response): void {
    const replies = [...this.replies.values()]
    this.replies.clear()
    for (const reply of replies) reply(response)
  }
}
