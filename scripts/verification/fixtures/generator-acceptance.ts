import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from '../verification-artifacts'

export async function verifyFixtureGeneration(kind: 'image' | 'pdf') {
  const pdf = kind === 'pdf'
  const id = pdf ? 'upgrade-0153-pdf-fixtures' : 'upgrade-0153-fixtures'
  await verificationWorkflow(id, async run => {
    const root = resolve(import.meta.dir, '../../..')
    const generated = join(run.directory, 'generated')
    const entry = join(root, 'scripts/verification', `${id}.ts`)
    const command = [process.execPath, entry, `--out=${generated}`]
    const child = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => {
      if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/PID', String(child.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' })
      else child.kill('SIGKILL')
    }, 600_000)
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      writeFileSync(join(run.directory, 'generator.log'), stdout + stderr)
      assert.equal(code, 0, (stdout + stderr).slice(-4000))
      const manifest = JSON.parse(readFileSync(join(generated, 'manifest.json'), 'utf8'))
      assert.equal(manifest.schemaVersion, 1)
      const entries = (pdf ? manifest.fixtures : manifest.samples) as Record<string, { bytes: number; sha256: string }>
      const expected = pdf ? ['normal.pdf', 'encrypted.pdf', 'form.pdf', 'truncated.pdf', 'cyclic.pdf']
        : ['photo.heic', 'photo.avif', 'control.jpg', 'decoy-ispe.heic', 'oversized-ispe.heic', 'missing-ispe.heic', 'truncated.heic', 'small.heic', 'small.avif']
      assert.deepEqual(Object.keys(entries).sort(), expected.sort())
      for (const [name, declared] of Object.entries(entries)) {
        const bytes = readFileSync(join(generated, name))
        assert(bytes.length > 0)
        assert.equal(bytes.length, declared.bytes, name)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), declared.sha256, name)
        if (pdf) assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', name)
        else if (name.endsWith('.jpg')) assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff', name)
        else assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', name)
      }
      if (pdf) {
        assert.equal(manifest.python.python, '3.12.15')
        assert.equal(manifest.python.pypdf, '6.21.1')
      } else {
        assert.equal(createHash('sha256').update(readFileSync(join(generated, manifest.source.path))).digest('hex'), manifest.source.sha256)
        assert.match(manifest.encoders.pillowHeif, /1\.8\.1/)
      }
      const published = join(root, '.cache/upgrade-20261018', pdf ? 'pdf-fixtures' : 'fixtures')
      cpSync(generated, published, { recursive: true })
      for (const [name, declared] of Object.entries(entries)) {
        assert.equal(createHash('sha256').update(readFileSync(join(published, name))).digest('hex'), declared.sha256, `published ${name}`)
      }
      run.json('generator-manifest.json', { command, published, manifest })
      run.complete([`fresh-${kind}-fixtures-match-recorded-bytes-and-hashes`], ['Other platforms', 'Decoder/product semantics are asserted by the following HEIC/PDF workflows'])
    } finally { clearTimeout(timer) }
  })
}
