#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import type { LoadedSource } from '../../packages/shared/src/sources/types'
import type { ApiCredential } from '../../packages/shared/src/sources/credential-manager'

// Failure contract, fixed before the resolver: public sources never touch the
// vault/refresh owner; legacy Pages remains public while sessions stay lazy.
// Every ordinary request must see the latest credential, and refresh failures
// must stop the HTTP request. MCP continues using its separate build boundary.
await verificationWorkflow('source-access', async run => {
  const requests: Array<{ authorization: string | null; apiKey: string | null }> = []
  const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    requests.push({ authorization: request.headers.get('authorization'), apiKey: request.headers.get('x-api-key') })
    return Response.json({ ok: true })
  } })
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    const sources = await import('../../packages/shared/src/sources')
    const { createApiSourceAccess, executeApiRequest } = sources
    let stored: ApiCredential | null = 'first-fixture', reads = 0, refreshes = 0, rejectRefresh = false
    const access = createApiSourceAccess({
      credentials: { getApiCredential: async () => { reads++; return stored } },
      refresh: { ensureFreshToken: async () => { refreshes++; return rejectRefresh
        ? { success: false, reason: 'fixture refresh cooldown' }
        : { success: true, token: 'fresh-fixture', refreshed: false } } },
    })
    function source(authType?: string, provider = 'custom', renew = false): LoadedSource {
      return { config: { id: 'fixture', name: 'Fixture', slug: 'fixture', enabled: true, type: 'api', provider,
        isAuthenticated: true, createdAt: 1, updatedAt: 1,
        api: { baseUrl: `http://127.0.0.1:${endpoint.port}`, ...(authType ? { authType } : {}),
          ...(authType === 'header' ? { headerName: 'X-Api-Key' } : {}),
          ...(renew ? { renewEndpoint: { path: '/renew', method: 'POST' } } : {}) } },
        guide: null, folderPath: run.directory, workspaceId: 'fixture' } as LoadedSource
    }
    const call = async (value: LoadedSource, usage: 'pages' | 'session') => {
      const resolved = access.forApi(value, { usage })
      await executeApiRequest(resolved.config, resolved.credential, { path: '/echo', method: 'GET' })
      return requests.at(-1)!
    }
    for (const usage of ['pages', 'session'] as const) {
      for (const provider of ['custom', 'google', 'slack', 'microsoft']) {
        await scene(`${usage}-${provider}-explicit-none-never-reads-credentials`, async () => {
          const before = [reads, refreshes]
          assert.deepEqual(await call(source('none', provider, true), usage), { authorization: null, apiKey: null })
          assert.deepEqual([reads, refreshes], before)
        })
      }
      await scene(`${usage}-ordinary-header-reads-latest`, async () => {
        const resolved = access.forApi(source('header'), { usage }), before = reads
        for (const value of ['first-fixture', 'updated-fixture']) {
          stored = value
          await executeApiRequest(resolved.config, resolved.credential, { path: '/echo', method: 'GET' })
          assert.equal(requests.at(-1)!.apiKey, value)
        }
        assert.equal(reads - before, 2)
      })
      for (const [auth, provider, renew] of [['oauth', 'custom', false], ['bearer', 'google', false], ['bearer', 'custom', true]] as const) {
        await scene(`${usage}-${provider}-${renew ? 'renew' : auth}-uses-refresh-owner`, async () => {
          const before = refreshes
          assert.equal((await call(source(auth, provider, renew), usage)).authorization, 'Bearer fresh-fixture')
          assert.equal(refreshes, before + 1)
        })
      }
      await scene(`${usage}-refresh-failure-stops-request`, async () => {
        const before = requests.length; rejectRefresh = true
        try { await assert.rejects(call(source('oauth'), usage), /cooldown/) }
        finally { rejectRefresh = false }
        assert.equal(requests.length, before)
      })
    }
    await scene('legacy-missing-authType-keeps-two-entry-policies', async () => {
      stored = 'legacy-fixture'; const before = reads
      assert.equal((await call(source(), 'pages')).authorization, null)
      assert.equal(reads, before)
      // Legacy builder reads the vault, but an absent authType also retains
      // the old no-auth header configuration. Do not silently add a header.
      assert.equal((await call(source(), 'session')).authorization, null)
      assert.equal(reads, before + 1)
    })
    await scene('missing-ordinary-credential-remains-unauthenticated', async () => {
      stored = null
      assert.equal((await call(source('bearer'), 'session')).authorization, null)
    })
    // Published builder callers must get the same explicit-public guarantee.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    for (const provider of ['google', 'slack', 'custom']) {
      await scene(`legacy-builder-${provider}-explicit-none`, async () => {
        let tokenReads = 0
        const api = await sources.getSourceServerBuilder().buildApiServer(source('none', provider), 'stale-fixture',
          async () => { tokenReads++; return 'stale-fixture' })
        assert(api)
        const [consumer, host] = InMemoryTransport.createLinkedPair()
        const client = new Client({ name: 'source-verification', version: '1' })
        await Promise.all([api.connect(host), client.connect(consumer)])
        try {
          const { tools } = await client.listTools()
          const result = await client.callTool({ name: tools[0]!.name, arguments: { path: '/echo', method: 'GET' } })
          assert(!result.isError)
          assert.equal(requests.at(-1)!.authorization, null)
          assert.equal(tokenReads, 0)
        } finally { await client.close(); await api.close() }
      })
    }
    run.json('requests.json', requests.map(request => ({ authorization: !!request.authorization, apiKey: !!request.apiKey })))
    run.json('scenarios.json', { checks, failures, reads, refreshes })
    assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Real external providers and secrets; refresh transport/cooldown separately covered by source regression tests'])
  } finally { endpoint.stop(true) }
})
