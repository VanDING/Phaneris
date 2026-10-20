/**
 * Build a verification fixture page and serve it as plain files.
 *
 * The build runs in a Node child (`fixture-bundle-host.mjs`) with the app's own
 * Vite config, then this process serves the output from a Bun.serve static
 * handler. Nothing about the browser driver shares an event loop with Vite.
 */
import { existsSync, statSync } from 'node:fs'
import { extname, join, normalize, relative, resolve } from 'node:path'

export interface FixtureBundle {
  url: string
  outDir: string
  close: () => Promise<void>
}

/** Kill a child and wait (bounded) for it to actually go away. */
async function killAndReap(child: { kill: () => void; exited: Promise<number> }): Promise<void> {
  try { child.kill() } catch { /* already gone */ }
  const reaped = await Promise.race([child.exited.then(() => true), Bun.sleep(10_000).then(() => false)])
  if (!reaped) { try { (child as { kill: (signal?: string) => void }).kill('SIGKILL') } catch { /* gone */ } }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

export async function buildFixturePage(options: { runDirectory: string; entry: string; timeoutMs?: number }): Promise<FixtureBundle> {
  const root = resolve(import.meta.dir, '../..')
  const node = Bun.which('node')
  if (!node) throw new Error('node was not found on PATH; the fixture build host runs under Node (see fixture-bundle-host.mjs)')
  const child = Bun.spawn([node, resolve(import.meta.dir, 'fixture-bundle-host.mjs'), options.runDirectory, options.entry], {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit',
  })
  const reader = child.stdout.getReader(), decoder = new TextDecoder()
  let buffered = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`fixture bundle did not finish within ${options.timeoutMs ?? 600_000}ms`)), options.timeoutMs ?? 600_000)
  })
  const handshake = (async () => {
    for (;;) {
      const value = await reader.read()
      if (value.done) return undefined
      buffered += decoder.decode(value.value, { stream: true })
      for (const line of buffered.split('\n')) {
        if (!line.trim().startsWith('{')) continue
        try {
          const parsed = JSON.parse(line) as { dir?: string; html?: string }
          if (parsed.dir && parsed.html) return parsed as { dir: string; html: string }
        } catch { /* not the handshake line */ }
      }
    }
  })()
  let built: { dir: string; html: string } | undefined
  try {
    built = await Promise.race([handshake, timeout])
  } catch (error) {
    // A failed build must not leave the child behind: the timer used to be the
    // only thing cleared here, so a timed-out bundle kept running (and could hold
    // the suite open) while the workflow had already given up on it.
    killAndReap(child)
    throw error
  } finally {
    clearTimeout(timer)
  }
  // The handshake only means "the build printed its result"; wait for the process
  // to actually end, but never without a deadline — an exited-but-unreaped child
  // must not hold the workflow open.
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(15_000).then(() => false)])
  if (!exited) {
    killAndReap(child)
    throw new Error('fixture bundle host did not exit after publishing its output')
  }
  if (!built || !existsSync(built.html)) throw new Error(`fixture bundle produced no html (exit ${child.exitCode})`)
  // Vite emits an HTML entry at its own path relative to the project root and
  // writes asset URLs relative to that page, so the whole output directory must
  // be served and the page opened at its path inside it.
  const outDir: string = built.dir
  const pageName = relative(outDir, built.html).replaceAll('\\', '/')

  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const requested = decodeURIComponent(url.pathname === '/' ? `/${pageName}` : url.pathname)
      const target = normalize(join(outDir, requested))
      if (!target.startsWith(outDir)) return new Response('forbidden', { status: 403 })
      if (!existsSync(target) || !statSync(target).isFile()) return new Response('not found', { status: 404 })
      return new Response(Bun.file(target), { headers: { 'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream' } })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}/${pageName}`,
    outDir,
    close: async () => { server.stop(true) },
  }
}
