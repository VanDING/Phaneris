import type { BrowserPaneFns } from './browser-tools'

/** Screenshot waiting is interruptible; an unfinished capture does not mutate a website. */
export function boundedBrowserCaptures(fns: BrowserPaneFns, signal?: AbortSignal, timeoutMs = 20_000): BrowserPaneFns {
  const bounded = <T>(call: () => Promise<T>): Promise<T> => {
    signal?.throwIfAborted()
    return new Promise<T>((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal?.reason ?? new Error('Browser capture cancelled')) }
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Browser capture timed out after ${timeoutMs}ms. The batch stopped; retry the capture after checking the page.`)) }, timeoutMs)
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      // Observe a late rejection too. A timed-out screenshot cannot restart its batch.
      Promise.resolve().then(() => { signal?.throwIfAborted(); return call() }).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    })
  }
  return { ...fns, screenshot: options => bounded(() => fns.screenshot(options)), screenshotRegion: options => bounded(() => fns.screenshotRegion(options)) }
}
