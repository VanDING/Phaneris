import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run as command } from '../check-environment'
import { verificationWorkflow } from './verification-artifacts'
import { verifyServerDistribution } from './server-distribution'

await verificationWorkflow('server-distribution', async evidence => {
  const outside = mkdtempSync(join(tmpdir(), 'phaneris-server-distribution-')), output = join(outside, 'distribution')
  try {
    await command(['run', 'scripts/build-server.ts', '--skip-download', `--output=${output}`], root,
      { logFile: join(evidence.directory, 'server-assembly.log') })
    const checks = await verifyServerDistribution(output, outside, evidence)
    evidence.complete(checks, ['clean native runtime downloads', 'signed installers', 'Windows/Linux native execution'])
  } finally { rmSync(outside, { recursive: true, force: true }) }
})
