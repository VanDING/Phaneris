import { chromium, type Browser } from 'playwright'

/** Bun on Windows cannot reliably hand Playwright's native pipes to Chromium. */
export async function launchWorkflowBrowser(): Promise<{ browser: Browser; close: () => Promise<void> }> {
  const channel = process.env.PHANERIS_TEST_BROWSER_CHANNEL
  if (process.platform !== 'win32' || !process.versions.bun) {
    const browser = await chromium.launch({ headless: true, channel })
    return { browser, close: () => browser.close() }
  }
  const child = Bun.spawn(['node', '-e', `
    const { chromium } = require('playwright');
    (async () => {
      const server = await chromium.launchServer({ headless: true, channel: process.argv[1] || undefined, timeout: 30000 });
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
    const browser = await chromium.connect(line.split('\n')[0]!.trim())
    return { browser, close: async () => {
      try { await browser.close() } finally {
        child.stdin.end()
        const timer = setTimeout(() => child.kill(), 10000)
        try { await child.exited } finally { clearTimeout(timer) }
      }
    } }
  } catch (error) { child.kill(); throw error }
  finally { reader.releaseLock() }
}
