/** Retry an interrupted, idempotent background read once. Never use for writes. */
export async function readAfterReconnect<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Connection lost') throw error
    const api = window.electronAPI
    if (!api.getTransportConnectionState || !api.onTransportConnectionStateChanged) throw error
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let unsubscribe = () => {}
      const finish = (failure?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribe()
        if (failure) reject(failure)
        else resolve()
      }
      const timer = setTimeout(() => finish(error), 30_000)
      try {
        unsubscribe = api.onTransportConnectionStateChanged(state => {
          if (state.status === 'connected') finish()
        })
        // Some adapters synchronously publish their current state on subscribe.
        if (settled) unsubscribe()
        void api.getTransportConnectionState().then(state => {
          if (state.status === 'connected') finish()
        }, finish)
      } catch (failure) { finish(failure) }
    })
    return read()
  }
}
