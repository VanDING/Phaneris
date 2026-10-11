import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts.ts'

await verificationWorkflow('config-domains', async run => {
  run.checkArguments()
  const scenes: string[] = []
  const results: unknown[] = []
  for (const name of ['first', 'second']) {
    const config = join(run.directory, name)
    mkdirSync(config)
    const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/config-domains.ts'], {
      cwd: resolve(import.meta.dir, '../..'),
      env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_BUNDLED_ASSETS_ROOT: join(config, 'missing-assets') },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, `${name}.log`), out + err)
    assert.equal(code, 0, err.slice(-3000))
    const result = JSON.parse(out.trim().split('\n').at(-1)!) as { checks: string[]; dir: string }
    assert.equal(result.dir, config)
    results.push(result)
    scenes.push(...result.checks.map(id => `${name}:${id}`))
  }
  const entry = join(run.directory, 'pure.ts')
  writeFileSync(entry, `import { PresetThemeSchema, StoredConfigSchema } from ${JSON.stringify(resolve('packages/shared/src/config/schemas.ts'))}; console.log(PresetThemeSchema, StoredConfigSchema)\n`)
  const build = await Bun.build({ entrypoints: [entry], target: 'browser' })
  assert(build.success, build.logs.map(String).join('\n'))
  const source = await build.outputs[0]!.text()
  assert(!source.includes('readFileSync') && !source.includes('PiAgent') && !source.includes('configDirInitialized'))
  scenes.push('browser-pure-schema')
  const a = JSON.parse(readFileSync(join(run.directory, 'first/config.json'), 'utf8'))
  const b = JSON.parse(readFileSync(join(run.directory, 'second/config.json'), 'utf8'))
  assert.deepEqual(a, b)
  scenes.push('isolated-config-dirs')
  run.json('config-domains.json', { scenes, results })
  run.complete(scenes, ['cross-process concurrent writes (unchanged synchronous writer contract)', 'live provider credential refresh', 'native Windows filesystem'])
})
