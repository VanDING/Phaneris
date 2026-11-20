import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PHANERIS_PROTOTYPE_PORT || 49731)
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
}
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return }
    const data = await readFile(path)
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(data)
  } catch { response.writeHead(404).end('Not found') }
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Focus panel prototype: http://127.0.0.1:${port}\n`))
