#!/usr/bin/env node
// Real loopback HTTP/cache and OCR child-process checks. Failure modes were
// recorded before implementing the local cache patch. No credentials used.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const CachePolicy = require('http-cache-semantics')
const tesseract = require('node-tesseract-ocr')

const output = path.resolve(process.env.PHANERIS_UPGRADE_ARTIFACTS || '.cache/dependency-upgrade-20261003')
fs.mkdirSync(output, { recursive: true })
const results = []
const scenarios = [
  { name: 'private', response: { 'cache-control': 'private, max-age=3600' }, cached: false },
  { name: 'no-store', response: { 'cache-control': 'no-store' }, cached: false },
  { name: 'response-no-cache', response: { 'cache-control': 'no-cache, max-age=3600' }, cached: false },
  { name: 'shared-set-cookie', response: { 'set-cookie': 'session=synthetic-victim', 'cache-control': 'max-age=3600' }, cached: false },
  { name: 'authenticated-not-public', request: { authorization: 'Bearer synthetic' }, response: { 'cache-control': 'max-age=3600' }, cached: false },
  { name: 'proxy-revalidate', response: { 'cache-control': 'max-age=3600, proxy-revalidate' }, cached: false },
  { name: 'zero-age-with-stale-while-revalidate', response: { 'cache-control': 'no-cache, stale-while-revalidate=3600' }, cached: false },
  { name: 'vary-star', response: { vary: '*', 'cache-control': 'max-age=3600' }, cached: false },
  { name: 'must-revalidate', response: { 'cache-control': 'max-age=1, must-revalidate', age: '10' }, cached: false },
  { name: 'public-fresh-control', response: { 'cache-control': 'public, max-age=3600' }, cached: true },
  { name: 'public-stale-control', response: { 'cache-control': 'public, max-age=1', age: '10' }, cached: true },
]
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))) }
function close(server) { return new Promise(resolve => server.close(resolve)) }
function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', text => { body += text })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
  })
}
async function cacheChecks() {
  const origin = http.createServer((req, res) => {
    const scenario = scenarios.find(s => '/' + s.name === req.url)
    res.writeHead(200, scenario.response)
    res.end('origin:' + (req.headers['x-synthetic-user'] || 'unknown'))
  })
  const originPort = await listen(origin)
  const stored = new Map()
  const proxy = http.createServer(async (req, res) => {
    try {
      const key = req.url
      const entry = stored.get(key)
      const incoming = { url: key, method: 'GET', headers: req.headers }
      const policy = entry && CachePolicy.fromObject(entry.policy)
      if (policy && policy.satisfiesWithoutRevalidation(incoming)) {
        res.writeHead(200, { 'x-cache': 'hit' })
        res.end(entry.body)
      } else {
        const fresh = await get('http://127.0.0.1:' + originPort + key, req.headers)
        res.writeHead(200, { 'x-cache': 'miss' })
        res.end(fresh.body)
      }
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  const proxyPort = await listen(proxy)
  try {
    for (const scenario of scenarios) for (const directive of ['max-stale=999999', 'max-stale']) {
      const key = '/' + scenario.name
      const originalHeaders = { host: 'synthetic-cache.test', ...scenario.request }
      const original = { url: key, method: 'GET', headers: originalHeaders }
      const response = { status: 200, headers: { date: new Date().toUTCString(), ...scenario.response } }
      // Exercise persisted zero-lifetime entries, the advisory's dangerous
      // state, including entries a cache should already have refused to store.
      stored.set(key, { policy: new CachePolicy(original, response).toObject(), body: 'cached:victim' })
      const reply = await get('http://127.0.0.1:' + proxyPort + key, {
        ...originalHeaders, 'cache-control': directive, 'x-synthetic-user': 'other-user',
      })
      const hit = reply.headers['x-cache'] === 'hit'
      const passed = reply.status === 200 && hit === scenario.cached && reply.body === (hit ? 'cached:victim' : 'origin:other-user')
      results.push({ check: 'http-cache', scenario: scenario.name, directive, passed, observed: reply.headers['x-cache'] })
    }
  } finally { await close(proxy); await close(origin) }
}
async function ocrCheck() {
  const fixture = path.join(output, 'ocr-argv-fixture.cjs')
  fs.writeFileSync(fixture, 'process.stdout.write(JSON.stringify(process.argv.slice(1)))\n')
  const text = await tesseract.recognize(fixture, {
    binary: process.execPath, lang: 'eng & echo SECURITY_SENTINEL', psm: '3 && echo SECURITY_SENTINEL',
  })
  const argv = JSON.parse(text)
  assert.ok(argv.includes('eng & echo SECURITY_SENTINEL'))
  assert.ok(argv.includes('3 && echo SECURITY_SENTINEL'))
  results.push({ check: 'ocr-execFile-literal-arguments', passed: true })
}
async function main() {
  await cacheChecks()
  try { await ocrCheck() }
  catch (error) { results.push({ check: 'ocr-execFile-literal-arguments', passed: false, error: error.message }) }
  fs.writeFileSync(path.join(output, 'security-e2e.json'), JSON.stringify({ node: process.version, results }, null, 2) + '\n')
  const failed = results.filter(x => !x.passed)
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }))
  if (failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
