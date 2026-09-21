type Listener = (html: string | null) => void
interface Job {
  id: number
  key: string
  code: string
  language: string
  theme: string
  listeners: Set<Listener>
}

const MAX_CACHE_BYTES = 8 * 1024 * 1024
const MAX_CACHE_ENTRIES = 200
const cache = new Map<string, string>()
const jobs = new Map<string, Job>()
let cacheBytes = 0
let sequence = 0
let active: Job | undefined
let worker: Worker | undefined
let workerUnavailable = false

export function codeHighlightKey(code: string, language: string, theme: string): string {
  return JSON.stringify([theme, language, code])
}

function finish(job: Job, html: string | null) {
  if (active !== job) return
  active = undefined
  jobs.delete(job.key)
  if (html !== null) {
    const bytes = (job.key.length + html.length) * 2
    if (bytes <= MAX_CACHE_BYTES) {
      while (cache.size && (cacheBytes + bytes > MAX_CACHE_BYTES || cache.size >= MAX_CACHE_ENTRIES)) {
        const key = cache.keys().next().value!
        cacheBytes -= (key.length + cache.get(key)!.length) * 2
        cache.delete(key)
      }
      cache.set(job.key, html)
      cacheBytes += bytes
    }
  }
  for (const listener of job.listeners) listener(html)
  pump()
}

function fallback(job: Job) {
  // Hosts without module workers retain plain text immediately; highlighting
  // is best effort and starts after yielding to the browser.
  setTimeout(async () => {
    if (!job.listeners.size) { finish(job, null); return }
    try {
      const { codeToHtml, bundledLanguages } = await import('shiki')
      const html = await codeToHtml(job.code, {
        lang: job.language in bundledLanguages ? job.language : 'text',
        theme: job.theme,
      })
      finish(job, html)
    } catch { finish(job, null) }
  }, 16)
}

function pump() {
  if (active) return
  const job = jobs.values().next().value as Job | undefined
  if (!job) return
  active = job
  if (!workerUnavailable) {
    try {
      if (!worker) {
        worker = new Worker(new URL('./syntax-highlight.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ id: number; html: string | null }>) => {
          if (active?.id === event.data.id) finish(active, event.data.html)
        }
        worker.onerror = () => {
          worker?.terminate()
          worker = undefined
          workerUnavailable = true
          if (active) fallback(active)
        }
      }
      worker.postMessage({ id: job.id, code: job.code, language: job.language, theme: job.theme })
      return
    } catch {
      workerUnavailable = true
      worker?.terminate()
      worker = undefined
    }
  }
  fallback(job)
}

/** Shared, deduplicated worker queue. Unmounted/offscreen revisions are removed
 * before execution; completed results are bounded by both entry count and bytes.
 */
export function requestCodeHighlight(code: string, language: string, theme: string, listener: Listener): () => void {
  const key = codeHighlightKey(code, language, theme)
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    listener(cached)
    return () => {}
  }
  let job = jobs.get(key)
  if (!job) {
    job = { id: ++sequence, key, code, language, theme, listeners: new Set() }
    jobs.set(key, job)
  }
  job.listeners.add(listener)
  pump()
  return () => {
    job.listeners.delete(listener)
    if (!job.listeners.size && active !== job) jobs.delete(key)
  }
}
