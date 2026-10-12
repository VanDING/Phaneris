import type { BrowserContext } from 'playwright'
/** Dev bundler preparation is separate from the instrumented acceptance page.
 * Production cold-start remains covered by theme-foundation/native. */
export async function warmThemePage(context: BrowserContext, url: string, selector: string) {
  const page = await context.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator(selector).first().waitFor({ timeout: 120_000 })
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
    const unexpected = errors.filter(value => !/504 \(Outdated Optimize Dep\)|Failed to fetch dynamically imported module/.test(value))
    if (unexpected.length) throw new Error(`Theme fixture preparation failed: ${unexpected.join('\n')}`)
    return { url, errors, scope: 'Vite dependency preparation only; acceptance runs in a separate page with an unfiltered error gate.' }
  } finally { await page.close() }
}
