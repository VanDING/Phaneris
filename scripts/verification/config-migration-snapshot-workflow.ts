/** Freeze startup migration behavior through two real subprocess startups. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('config-migration-snapshot', async run => {
  const storage = pathToFileURL(resolve('packages/shared/src/config/storage.ts')).href
  const setup = pathToFileURL(resolve('packages/shared/tests/setup/register-pi-model-resolver.ts')).href
  const cases = [
    { id: 'legacy-bedrock-defaults', connection: { providerType: 'bedrock', authType: 'iam_credentials',
      defaultModel: 'anthropic.claude-opus-4-5-20251101-v1:0', models: ['anthropic.claude-opus-4-5-20251101-v1:0'] },
      legacy: { modelDefaults: { pi: 'pi/claude-opus-4-5-20251101' } } },
    { id: 'legacy-anthropic-endpoint', connection: { providerType: 'anthropic_compat', authType: 'api_key',
      baseUrl: 'https://example.invalid', defaultModel: 'private-model', models: ['private-model'] }, legacy: {} },
    { id: 'user-owned-custom-models', connection: { providerType: 'pi_compat', authType: 'api_key_with_endpoint',
      baseUrl: 'https://example.invalid', customEndpoint: { api: 'openai-completions' },
      defaultModel: 'private-model', models: ['private-model'] }, legacy: {} },
    { id: 'versioned-opus-restore', connection: { providerType: 'pi', piAuthProvider: 'anthropic', authType: 'api_key',
      defaultModel: 'pi/claude-opus-4-7', models: ['pi/claude-opus-4-7'] },
      legacy: { migrationsApplied: ['opus-4-6-restored'] } },
  ]
  const scenes: string[] = []
  for (const fixture of cases) {
    const config = join(run.directory, fixture.id), workspace = join(config, 'workspace')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'snapshot', name: 'Snapshot', slug: 'snapshot', createdAt: 1, updatedAt: 1 }))
    const path = join(config, 'config.json')
    const before = { workspaces: [{ id: 'snapshot', name: 'Snapshot', rootPath: workspace, createdAt: 1 }],
      activeWorkspaceId: 'snapshot', activeSessionId: null, defaultLlmConnection: 'fixture',
      llmConnections: [{ slug: 'fixture', name: 'Fixture', createdAt: 1, ...fixture.connection }], ...fixture.legacy }
    writeFileSync(path, JSON.stringify(before))
    const migrate = (label: string) => {
      const process = Bun.spawnSync([globalThis.process.execPath, '--eval',
        `import '${setup}'; import { migrateLegacyLlmConnectionsConfig } from '${storage}'; migrateLegacyLlmConnectionsConfig();`], {
        env: { ...globalThis.process.env, PHANERIS_CONFIG_DIR: config }, stdout: 'pipe', stderr: 'pipe',
      })
      writeFileSync(join(config, `${label}.log`), process.stdout.toString() + process.stderr.toString())
      assert.equal(process.exitCode, 0, `${fixture.id}/${label}`)
      return JSON.parse(readFileSync(path, 'utf8'))
    }
    const first = migrate('first'), second = migrate('second'), third = migrate('third')
    run.json(`${fixture.id}.json`, { before, first, second, third,
      workspace: JSON.parse(readFileSync(join(workspace, 'config.json'), 'utf8')) })
    if (fixture.id === 'legacy-bedrock-defaults') {
      // Existing phase ordering infers modelSelectionMode on the next startup,
      // after the legacy provider has become Pi. Freeze this drift explicitly.
      assert.equal(first.llmConnections[0].modelSelectionMode, undefined)
      assert.equal(second.llmConnections[0].modelSelectionMode, 'userDefined3Tier')
      const withMode = { ...first, llmConnections: first.llmConnections.map((connection: object) => ({
        ...connection, modelSelectionMode: 'userDefined3Tier',
      })) }
      assert.deepEqual(second, withMode)
    } else assert.deepEqual(second, first, `${fixture.id} must be idempotent`)
    assert.deepEqual(third, second, `${fixture.id} must stabilize after provider migration`)
    if (fixture.id === 'user-owned-custom-models') {
      assert.deepEqual(second.llmConnections[0].models, ['private-model'])
      assert.equal(second.llmConnections[0].defaultModel, 'private-model')
    }
    if (fixture.id === 'versioned-opus-restore') {
      assert(second.migrationsApplied.includes('opus-4-6-restored-2'))
      const without = { ...second, llmConnections: second.llmConnections.map((connection: { models: Array<string | { id: string }> }) => ({
        ...connection, models: connection.models.filter(entry => (typeof entry === 'string' ? entry : entry.id).replace(/^pi\//, '') !== 'claude-opus-4-6'),
      })) }
      writeFileSync(path, JSON.stringify(without))
      assert.deepEqual(migrate('user-removal'), without, 'A deliberate model removal after the marker must persist')
    }
    scenes.push(fixture.id)
  }
  run.complete(scenes, ['live provider model availability', 'unsupported historical configurations outside the existing integration fixtures'])
})
