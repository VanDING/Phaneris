/** Production React sidebar + Electron CSS, driven by Node's native browser pipes. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('sidebar-refinement', async run => {
  const root = resolve(import.meta.dir, '../..')
  console.log(`Sidebar verification artifacts: ${run.directory}`)
  const child = Bun.spawn(['node', join(import.meta.dir,'fixtures/sidebar-refinement.cjs'), JSON.stringify({root,output:run.directory})],
    {cwd:root,stdout:'pipe',stderr:'pipe'})
  const timer = setTimeout(() => child.kill(),180_000)
  try {
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    writeFileSync(join(run.directory,'browser.log'),stdout+stderr)
    assert.equal(code,0,(stdout+stderr).slice(-6000))
    const report = JSON.parse(readFileSync(join(run.directory,'browser-result.json'),'utf8')) as {checks:string[];untested:string[]}
    run.complete(report.checks,report.untested)
    console.log(stdout.trim())
  } finally {clearTimeout(timer)}
})
