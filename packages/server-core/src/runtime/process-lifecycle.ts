/** Last-resort process boundary; recoverable errors belong to their resource owner. */
export interface ProcessLifecycleOptions {
  owner: string
  stopAccepting: () => void
  cleanup: () => void | Promise<void>
  report: (kind: string, detail: string, reason: unknown) => void
  exit: (code: number) => void
  timeoutMs?: number
}

function errorDetail(reason: unknown): string {
  const seen = new Set<unknown>(), parts: string[] = []
  for (let current = reason; current !== undefined && !seen.has(current) && parts.length < 8;) {
    seen.add(current)
    if (current instanceof Error) {
      const title = `${current.name}: ${current.message}`
      const stack = current.stack
      // Some runtime stack formatters omit the message after asynchronous module
      // loading. The original failure and cause must survive that formatting.
      parts.push(stack?.startsWith(title) ? stack : stack ? `${title}\n${stack}` : title)
    } else parts.push(String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join('\nCaused by: ')
}

export function installProcessLifecycle(options: ProcessLifecycleOptions) {
  let stopping = false, finished = false, exitCode = 0
  let deadline: ReturnType<typeof setTimeout> | undefined
  const report = (kind: string, reason: unknown) => {
    try { options.report(kind, `[${options.owner}] ${errorDetail(reason)}`, reason) } catch {
      // A broken diagnostic sink must never re-enter fatal handling.
    }
  }
  const finish = () => {
    if (finished) return
    finished = true; clearTimeout(deadline)
    options.exit(exitCode)
  }
  const start = () => {
    if (stopping) return
    stopping = true
    // The timer stays referenced: a hung cleanup with no open sockets must still exit.
    deadline = setTimeout(() => {
      exitCode = 1; report('shutdown_deadline', new Error('Process cleanup deadline exceeded')); finish()
    }, options.timeoutMs ?? 10_000)
    try { options.stopAccepting() } catch (error) {
      exitCode = 1; report('quiesce_failed', error); finish(); return
    }
    void Promise.resolve().then(options.cleanup).then(finish, error => {
      exitCode = 1; report('cleanup_failed', error); finish()
    })
  }
  const fail = (kind: string, reason: unknown) => {
    if (finished) return
    exitCode = 1
    // Retain the first fatal diagnosis, and never restart cleanup or its deadline.
    if (!stopping) report(kind, reason)
    start()
  }
  const onException = (error: Error) => fail('uncaughtException', error)
  const onRejection = (reason: unknown) => fail('unhandledRejection', reason)
  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)
  return { fail, shutdown: () => start(),
    dispose: () => { process.off('uncaughtException', onException); process.off('unhandledRejection', onRejection) } }
}
