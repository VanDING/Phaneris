import { chromium, type Browser, type Page } from 'playwright'

/** Playwright's in-page polling treats a Promise as truthy. Await RPC conditions on the driver. */
export async function waitForBrowserCondition<Argument = undefined>(page: Page,
  predicate: (argument: Argument) => boolean | Promise<boolean>, argument?: Argument, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await page.evaluate<boolean>(predicate as () => boolean | Promise<boolean>, argument)) {
    if (Date.now() >= deadline) throw new Error(`Browser condition did not become true within ${timeoutMs}ms`)
    await Bun.sleep(50)
  }
}

/**
 * Navigate with a bounded retry.
 *
 * A Vite dev server optimizes dependencies on demand and, when the crawl finds a
 * new one mid-navigation, logs "optimized dependencies changed. reloading" and
 * reloads the page. A navigation that overlaps that reload never settles and
 * `waitUntil: 'networkidle'` times out even though nothing is wrong with the
 * page; the reload completes and the same navigation succeeds. Retrying keeps
 * the assertion strict — the page must still load and satisfy it.
 */
export async function gotoWithRetry(page: Page, url: string,
  options: { waitUntil?: 'domcontentloaded' | 'networkidle' | 'load'; timeoutMs?: number; attempts?: number } = {}): Promise<void> {
  // Two attempts, not three: the reload this covers happens within seconds of the
  // first navigation, while a genuine failure must still surface quickly.
  const attempts = options.attempts ?? 2
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: options.waitUntil ?? 'networkidle', timeout: options.timeoutMs ?? 90_000 })
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) await Bun.sleep(2_000)
    }
  }
  throw lastError
}

/** Launch Chromium directly. This is the supported path under Bun 1.4.3. */
export async function launchWorkflowBrowser(): Promise<{ browser: Browser; close: () => Promise<void> }> {
  const channel = process.env.PHANERIS_TEST_BROWSER_CHANNEL
  try {
    const browser = await chromium.launch({ headless: true, channel })
    return { browser, close: () => browser.close() }
  } catch (directError) {
    if (process.platform !== 'win32' || !process.versions.bun) throw directError
    // Older Bun builds could not hand Playwright's native stdio pipes to
    // Chromium. Keep a bridged fallback so the suite still runs there: launch a
    // browser server from Node and connect over WebSocket.
    console.warn(`[workflow-browser] direct launch failed, falling back to a browser server: ${
      directError instanceof Error ? directError.message.split('\n')[0] : String(directError)}`)
    return await launchViaBrowserServer(channel, directError)
  }
}

/**
 * Connect to a separately launched browser server.
 *
 * The endpoint is read from the child's stdout, so the child keeps logging into
 * a pipe that must stay drained; and the published host can be `[::1]`, which
 * Bun's WebSocket client may refuse, so the same port is retried over IPv4 once.
 * Both attempts and their errors are reported, so a failure names the transport
 * instead of looking like a page regression.
 */
async function connectToBrowserServer(endpoint: string): Promise<Browser> {
  const attempts = [endpoint]
  try {
    const parsed = new URL(endpoint)
    if (parsed.hostname === '[::1]' || parsed.hostname === '::1') {
      const ipv4 = new URL(endpoint)
      ipv4.hostname = '127.0.0.1'
      attempts.push(ipv4.toString())
    }
  } catch { /* endpoint was not a URL; the single attempt below reports it */ }

  const failures: string[] = []
  for (const attempt of attempts) {
    try {
      return await chromium.connect(attempt, { timeout: 20_000 })
    } catch (error) {
      failures.push(`${attempt} -> ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    }
  }
  throw new Error(`Playwright browser connect failed (${attempts.length} attempt(s)):\n${failures.join('\n')}`)
}

/**
 * Bridged fallback: launch the browser server from Node, connect over WebSocket.
 * Only used when a direct launch fails (older Bun builds on Windows).
 */
async function launchViaBrowserServer(
  channel: string | undefined,
  cause: unknown,
): Promise<{ browser: Browser; close: () => Promise<void> }> {
  const child = Bun.spawn(['node', '-e', `
    const { chromium } = require('playwright');
    (async () => {
      // Bind IPv4 explicitly. Playwright's default host is "localhost", which on
      // Windows resolves to ::1 and produces an IPv6-only listener; Bun's
      // WebSocket client then cannot complete the handshake against either
      // family (::1 hangs, 127.0.0.1 is refused) and every browser workflow
      // failed before its first page.
      const server = await chromium.launchServer({ headless: true, host: '127.0.0.1', channel: process.argv[1] || undefined, timeout: 30000 });
      console.log(server.wsEndpoint());
      process.stdin.resume();
      process.stdin.on('end', async () => { await server.close(); });
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, channel ?? ''], { cwd: process.cwd(), stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  const reader = child.stdout.getReader(), decoder = new TextDecoder()
  let line = ''
  try {
    while (!line.includes('\n')) {
      const value = await reader.read()
      if (value.done) throw new Error('Playwright browser server exited before publishing its endpoint')
      line += decoder.decode(value.value, { stream: true })
    }
    const endpoint = line.split('\n')[0]!.trim()
    // Keep draining the child's stdout for the rest of its life. The endpoint is
    // the first line, not the only one: Playwright also logs to stdout, and an
    // undrained pipe fills up and blocks the browser server — which looks exactly
    // like a connection that never completes. The drain owns the reader, so it is
    // not released below.
    const drained = (async () => {
      try { for (;;) { const value = await reader.read(); if (value.done) return } } catch { /* child gone */ }
    })()
    const browser = await connectToBrowserServer(endpoint)
    return { browser, close: async () => {
      try { await browser.close() } finally {
        child.stdin.end()
        const timer = setTimeout(() => child.kill(), 10000)
        try { await child.exited } finally { clearTimeout(timer); await drained.catch(() => {}) }
      }
    } }
  } catch (error) {
    // Never leave the browser server behind on a failed connect.
    child.kill()
    throw error
  }
}
