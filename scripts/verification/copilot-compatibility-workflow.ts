#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Fix the published contract before restoring its target: preserve all four
// functions, callback shapes, enterprise routing, credential/model filtering,
// cancellation, and error propagation. Product login keeps using the native SDK;
// the legacy path must not start newly enabling model policies for old clients.
await verificationWorkflow('copilot-compatibility', async run => {
  const checks: string[] = [], requests: Array<{ path: string; host: string; hasAuthorization: boolean }> = []
  let invalidToken = false, polls = 0
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/login/device/code')) return Response.json({ device_code: 'fixture-device', user_code: 'FIXTURE', verification_uri: 'https://enterprise.example/device', interval: 1, expires_in: 20 })
    if (path.endsWith('/login/oauth/access_token')) { polls++; return Response.json({ access_token: 'fixture-github' }) }
    if (path.endsWith('/copilot_internal/v2/token')) return Response.json(invalidToken ? { token: null } : { token: 'proxy-ep=proxy.fixture.example;', expires_at: 2_000_000_000 })
    if (path.endsWith('/models') && request.method === 'GET') return Response.json({ data: [
      { id: 'allowed', model_picker_enabled: true, capabilities: { supports: { tool_calls: true } } },
      { id: 'disabled', model_picker_enabled: true, policy: { state: 'disabled' } },
      { id: 'no-tools', model_picker_enabled: true, capabilities: { supports: { tool_calls: false } } },
      { id: 'hidden', model_picker_enabled: false },
    ] })
    throw new Error(`Unexpected legacy HTTP operation ${request.method} ${path}`)
  } })
  const originalFetch = globalThis.fetch
  globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    requests.push({ path: url.pathname, host: url.hostname, hasAuthorization: new Headers(init?.headers).has('authorization') })
    return originalFetch(`http://127.0.0.1:${host.port}${url.pathname}`, init)
  }, originalFetch) as typeof fetch
  try {
    const compat = await import('@phaneris/shared/auth/github-copilot')
    assert.deepEqual(Object.keys(compat).sort(), ['getGitHubCopilotBaseUrl', 'loginGitHubCopilot', 'normalizeDomain', 'refreshGitHubCopilotToken'])
    checks.push('real-consumer-import-and-original-symbols')
    assert.equal(compat.normalizeDomain(' https://Enterprise.Example/path '), 'enterprise.example')
    assert.equal(compat.normalizeDomain(''), null)
    assert.equal(compat.getGitHubCopilotBaseUrl('proxy-ep=proxy.business.example;', 'enterprise.example'), 'https://api.business.example')
    assert.equal(compat.getGitHubCopilotBaseUrl(undefined, 'enterprise.example'), 'https://copilot-api.enterprise.example')
    assert.equal(compat.getGitHubCopilotBaseUrl(), 'https://api.individual.githubcopilot.com')
    checks.push('domain-and-proxy-precedence')
    const callbacks: Array<{ event: string; value?: unknown }> = []
    const credentials = await compat.loginGitHubCopilot({ onPrompt: async prompt => {
      assert.equal(prompt.allowEmpty, true); return 'https://enterprise.example'
    }, onDeviceCode: value => callbacks.push({ event: 'device', value }), onProgress: value => callbacks.push({ event: 'progress', value }) })
    assert.equal(credentials.enterpriseUrl, 'enterprise.example'); assert.equal(credentials.refresh, 'fixture-github')
    assert.deepEqual(credentials.availableModelIds, ['allowed']); assert.equal(credentials.expires, 1_999_999_700_000)
    assert.equal(polls, 1); assert.deepEqual(callbacks[0]?.value, { userCode: 'FIXTURE', verificationUri: 'https://enterprise.example/device' })
    assert(requests.some(request => request.host === 'api.enterprise.example'))
    checks.push('device-flow-callbacks-enterprise-and-credential-shape')
    const refreshed = await compat.refreshGitHubCopilotToken('fixture-github', 'enterprise.example')
    assert.deepEqual(refreshed.availableModelIds, ['allowed']); assert.equal(refreshed.refresh, 'fixture-github')
    checks.push('refresh-contract-and-model-policy-filter')
    const before = requests.length, abort = new AbortController(); abort.abort()
    await assert.rejects(compat.loginGitHubCopilot({ signal: abort.signal, onPrompt: async () => '', onDeviceCode() {} }), /cancel/i)
    assert.equal(requests.length, before); checks.push('cancel-before-network')
    invalidToken = true
    await assert.rejects(compat.refreshGitHubCopilotToken('fixture-github'), /Invalid Copilot token response fields/)
    checks.push('malformed-provider-response-rejected')
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, '../../packages/shared/package.json'), 'utf8')) as { exports: Record<string, string> }
    for (const target of Object.values(manifest.exports)) if (!target.includes('*')) assert(existsSync(resolve(import.meta.dir, '../../packages/shared', target)), target)
    checks.push('all-explicit-shared-export-targets-exist')
    run.json('compatibility.json', { checks, callbacks, requests, productPath: 'SDK-native provider; unchanged', restoredContract: '720c61532^' })
    run.complete(checks, ['Real GitHub login and external accounts; fixture HTTP only, no model policy POSTs'])
  } finally { globalThis.fetch = originalFetch; host.stop(true) }
})
