/** SEC-01: real cross-origin redirects with caller credentials, including node:vm arrays. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const vm = require('node:vm')
const { http: followHttp } = require('follow-redirects')
const output = path.resolve(process.argv[2] || '.cache/upgrade-20261107/redirect-security')
fs.mkdirSync(output, { recursive: true })
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = server => new Promise(resolve => server.close(resolve))
const request = (url, sensitiveHeaders) => new Promise((resolve, reject) => {
  const req = followHttp.get(url, { headers: { 'X-API-Key': 'synthetic-key', 'X-Control': 'retained' }, sensitiveHeaders }, response => {
    let body = ''
    response.on('data', chunk => { body += chunk })
    response.on('end', () => resolve(JSON.parse(body)))
  })
  req.on('error', reject)
  req.setTimeout(5000, () => req.destroy(new Error('Redirect request exceeded deadline')))
})
async function main() {
  const target = http.createServer((req, res) => res.end(JSON.stringify(req.headers)))
  const targetPort = await listen(target)
  const source = http.createServer((req, res) => {
    if (req.url === '/headers') return res.end(JSON.stringify(req.headers))
    res.writeHead(302, { location: req.url === '/cross' ? `http://127.0.0.1:${targetPort}/headers` : '/headers' })
    res.end()
  })
  const sourcePort = await listen(source)
  const scenes = []
  try {
    for (const [name, headers] of [['same-realm', ['X-API-Key']], ['cross-realm', vm.runInNewContext('["X-API-Key"]')]]) {
      const cross = await request(`http://127.0.0.1:${sourcePort}/cross`, headers)
      assert.equal(cross['x-api-key'], undefined, `${name} cross-origin credentials`)
      assert.equal(cross['x-control'], 'retained')
      const same = await request(`http://127.0.0.1:${sourcePort}/same`, headers)
      assert.equal(same['x-api-key'], 'synthetic-key')
      scenes.push({ name, cross, same, passed: true })
    }
    const report = { node: process.version, followRedirects: require('follow-redirects/package.json').version, scenes }
    fs.writeFileSync(path.join(output, 'redirect-security.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally { await Promise.all([close(source), close(target)]) }
}
main().catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); console.error(error); process.exitCode = 1 })
