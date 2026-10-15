/** Default upgrades must preserve custom entries, original bytes, and idempotence. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('tool-icons-upgrade', async run => {
  const config = mkdtempSync(join(tmpdir(), 'phaneris-tool-icons-'))
  process.env.PHANERIS_CONFIG_DIR = config
  const { setBundledAssetsRoot } = await import('../../packages/shared/src/utils/paths')
  setBundledAssetsRoot(resolve(import.meta.dir, '../../apps/electron'))
  const { ensureToolIcons } = await import('../../packages/shared/src/config/bundled-assets')
  const { resolveToolIcon } = await import('../../packages/shared/src/utils/cli-icon-resolver')
  const folder = join(config, 'tool-icons')
  mkdirSync(folder)
  const file = join(folder, 'tool-icons.json')
  const legacy = { id: 'craft-agent', displayName: 'Craft Agent', icon: 'craft-agent.svg', commands: ['craft-agent'] }
  const custom = { id: 'custom', displayName: 'My CLI', icon: 'mine.svg', commands: ['my-cli'] }
  const before = JSON.stringify({ version: 1, tools: [legacy, custom] }, null, 4)
  writeFileSync(file, before)
  const originalArtwork = readFileSync(resolve(import.meta.dir, '../../apps/electron/resources/tool-icons/craft-agent.svg'), 'utf8')
  writeFileSync(join(folder, 'craft-agent.svg'), originalArtwork)
  ensureToolIcons()
  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(after.tools[0], { id: 'phaneris', displayName: 'Phaneris', icon: 'phaneris.svg', commands: ['phaneris'] })
  assert.deepEqual(after.tools[1], custom)
  assert.equal(readFileSync(join(folder, 'tool-icons.pre-phaneris.json'), 'utf8'), before)
  assert.equal(readFileSync(join(folder, 'craft-agent.svg'), 'utf8'), originalArtwork)
  assert(existsSync(join(folder, 'phaneris.svg')))
  assert.equal(resolveToolIcon('phaneris --help', folder)?.displayName, 'Phaneris')
  assert.equal(resolveToolIcon(legacy.commands[0] + ' --help', folder)?.displayName, 'Phaneris')
  const migrated = readFileSync(file, 'utf8')
  ensureToolIcons()
  assert.equal(readFileSync(file, 'utf8'), migrated)
  const customized = JSON.stringify({ version: 1, tools: [{ ...legacy, displayName: 'My customized agent' }, custom] })
  writeFileSync(file, customized)
  ensureToolIcons()
  assert.equal(readFileSync(file, 'utf8'), customized)
  const customArtworkConfig = JSON.stringify({ version: 1, tools: [legacy, custom] })
  writeFileSync(file, customArtworkConfig)
  writeFileSync(join(folder, 'craft-agent.svg'), '<svg>my custom artwork</svg>')
  ensureToolIcons()
  assert.equal(readFileSync(file, 'utf8'), customArtworkConfig)
  run.json('upgrade.json', { before: JSON.parse(before), after, customPreserved: true, idempotent: true })
  run.complete(['legacy-default-migrated', 'original-config-backed-up', 'custom-icons-and-entries-preserved', 'idempotent-startup', 'customized-agent-preserved', 'customized-artwork-preserved'], [])
})
