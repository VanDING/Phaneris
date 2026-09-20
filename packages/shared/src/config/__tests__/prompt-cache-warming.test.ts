import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

test('warming defaults off, persists across restarts and is independent of extended retention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phaneris-cache-setting-'))
  const path = join(dir, 'config.json')
  const moduleUrl = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
  const run = (code: string) => {
    const result = Bun.spawnSync([process.execPath, '--eval',
      `import { getPromptCacheWarming, setPromptCacheWarming, getExtendedPromptCache } from ${JSON.stringify(moduleUrl)}; ${code}`],
    { env: { ...process.env, PHANERIS_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    return result.stdout.toString().trim()
  }
  try {
    writeFileSync(path, JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null,
      llmConnections: [], extendedPromptCache: true }))
    expect(run('console.log(getPromptCacheWarming()); setPromptCacheWarming(true);')).toBe('false')
    expect(JSON.parse(readFileSync(path, 'utf8')).promptCacheWarming).toBe(true)
    expect(run('console.log(getPromptCacheWarming(), getExtendedPromptCache()); setPromptCacheWarming(false);')).toBe('true true')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ promptCacheWarming: false, extendedPromptCache: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 15000)
