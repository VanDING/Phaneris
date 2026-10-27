/** Local review server. No writes, external requests or product configuration. */
import { join } from 'node:path'
const files = new Set(['index.html', 'styles.css', 'app.js'])
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PHANERIS_PREVIEW_PORT ?? 0), fetch(request) {
  const name = new URL(request.url).pathname.slice(1) || 'index.html'
  if (!files.has(name)) return new Response('Not found', { status: 404 })
  return new Response(Bun.file(join(import.meta.dir, name)))
} })
console.log(`Run design review: http://127.0.0.1:${server.port}/`)
