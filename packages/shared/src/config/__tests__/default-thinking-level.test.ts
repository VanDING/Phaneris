import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { THINKING_LEVEL_IDS } from '../../agent/thinking-levels.ts'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupWorkspaceConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'phaneris-config-thinking-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws-config-1',
      name: 'My Workspace',
      slug: 'my-workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  )

  const configPath = join(configDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      llmConnections: [],
    }, null, 2),
    'utf-8',
  )

  writeFileSync(
    join(configDir, 'config-defaults.json'),
    JSON.stringify({
      version: 'test',
      description: 'test defaults',
      defaults: {
        notificationsEnabled: true,
        colorTheme: 'default',
        autoCapitalisation: true,
        sendMessageKey: 'enter',
        spellCheck: false,
        keepAwakeWhileRunning: false,
        richToolDescriptions: true,
      },
      workspaceDefaults: {
        thinkingLevel: 'off',
        permissionMode: 'ask',
        cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
        localMcpServers: { enabled: true },
      },
    }, null, 2),
    'utf-8',
  )

  return { configDir, configPath }
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getDefaultThinkingLevel, setDefaultThinkingLevel } from '${STORAGE_MODULE_PATH}'; ${code}`,
  ], {
    env: { ...process.env, PHANERIS_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

/**
 * Every test here spawns a fresh Bun process, which cold-loads the whole storage
 * module graph (~0.5-0.9s standalone). Bun runs test *files* in parallel, so a
 * single spawn can exceed bun's 5-second default under contention — the heavy
 * test below already carried an explicit 15s for exactly that reason, and the
 * rest did not, which made each of them a latent timeout. One of them
 * (`falls back to bundled default`) failed twice at ~5.03s, and because the same
 * gate runs as the pre-push hook it blocked a push rather than merely annoying
 * CI. Same budget for all of them, declared once.
 */
const SUBPROCESS_TEST_TIMEOUT_MS = 15_000

describe('default thinking level storage', () => {
  it('falls back to bundled default when no app-level default is set', () => {
    const { configDir } = setupWorkspaceConfigDir()
    const output = runEval(configDir, "console.log(String(getDefaultThinkingLevel()))")
    expect(output).toBe('off')
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  it('persists defaultThinkingLevel to config.json', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()

    runEval(configDir, "setDefaultThinkingLevel('max'); console.log(String(getDefaultThinkingLevel()))")

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(config.defaultThinkingLevel).toBe('max')
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  it('round-trips persisted value across processes', () => {
    const { configDir } = setupWorkspaceConfigDir()
    runEval(configDir, "setDefaultThinkingLevel('medium')")
    const output = runEval(configDir, "console.log(String(getDefaultThinkingLevel()))")
    expect(output).toBe('medium')
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  it('supports every thinking level', () => {
    const { configDir } = setupWorkspaceConfigDir()
    // ONE subprocess sets + reads every level through the real disk path. A
    // spawn per level cold-loads the whole storage module graph (~0.5s each ×
    // 2 spawns × every level) and blew past bun's 5s default on CI runners —
    // cross-process persistence itself is pinned by the round-trip test above.
    const script = THINKING_LEVEL_IDS
      .map((level) => `setDefaultThinkingLevel('${level}'); console.log(String(getDefaultThinkingLevel()));`)
      .join(' ')
    const output = runEval(configDir, script)
    expect(output.split('\n')).toEqual([...THINKING_LEVEL_IDS])

    // And the LAST write survives to a fresh process (disk, not module state).
    const last = THINKING_LEVEL_IDS[THINKING_LEVEL_IDS.length - 1]!
    expect(runEval(configDir, "console.log(String(getDefaultThinkingLevel()))")).toBe(last)
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  it('migrates legacy "think" value to "medium"', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()
    // Manually write the legacy 'think' value to config
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    config.defaultThinkingLevel = 'think'
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    const output = runEval(configDir, "console.log(String(getDefaultThinkingLevel()))")
    expect(output).toBe('medium')
  }, SUBPROCESS_TEST_TIMEOUT_MS)
})
