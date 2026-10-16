/** Exercise the existing bundle test driver with real child processes and isolated cwd files. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('project-governance-round2-process', async run => {
  const source = readFileSync(join(import.meta.dir, '../../packages/pi-agent-server/src/bundle-smoke.test.ts'), 'utf8')
  const start = source.indexOf('function driveBundle('), end = source.indexOf("describe('pi-agent-server bundle'")
  assert(start >= 0 && end > start, 'The existing test driver must be extracted verbatim')
  const driver = source.slice(start, end)
  writeFileSync(join(run.directory, 'driver-source.ts'), driver)
  const fixture = join(run.directory, 'child.ts')
  writeFileSync(fixture, `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.PHANERIS_R2_PID!, String(process.pid));
if(process.env.PHANERIS_R2_MODE==='early-exit') process.exit(3);
if(process.env.PHANERIS_R2_MODE==='success') {console.log('TERMINAL'); console.log('TERMINAL');}
setInterval(()=>{},60000);`)
  const runner = join(run.directory, 'driver.ts')
  writeFileSync(runner, `import {spawn} from 'node:child_process'; import nodeProcess from 'node:process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs'; import {join,dirname} from 'node:path';
import assert from 'node:assert/strict';
const directory=${JSON.stringify(run.directory)}, mode=nodeProcess.argv[2];
const scratchDir=join(directory,mode); mkdirSync(scratchDir);
const pidFile=join(directory,mode+'.pid'), bundlePath=${JSON.stringify(fixture)};
const blockNetworkPreloadPath=${JSON.stringify(join(import.meta.dir, '../../packages/pi-agent-server/src/test-fixtures/block-network.ts'))};
const RUN_TIMEOUT_MS=1500, process={execPath:mode==='spawn-error'?join(directory,'missing-bun.exe'):nodeProcess.execPath};
const createOfflineEnvironment=()=>({PATH:nodeProcess.env.PATH,SystemRoot:nodeProcess.env.SystemRoot,WINDIR:nodeProcess.env.WINDIR,
PHANERIS_R2_PID:pidFile,PHANERIS_R2_MODE:mode});
${driver}
let result='resolved', error='', output='';
try {output=await driveBundle([], value=>value.includes('TERMINAL'));} catch(e) {result='rejected';error=String(e);}
const pid=existsSync(pidFile)?Number(readFileSync(pidFile,'utf8')):null;
let alive=false; if(pid) try {nodeProcess.kill(pid,0);alive=true;} catch {}
if(alive&&pid) nodeProcess.kill(pid);
assert.equal(dirname(scratchDir),directory); rmSync(scratchDir,{recursive:true,force:true});
writeFileSync(join(directory,mode+'.json'),JSON.stringify({mode,result,error,output,pid,aliveAtSettlement:alive,cwdRemoved:!existsSync(scratchDir)}));`)
  const checks = []
  for (const mode of ['success', 'early-exit', 'timeout', 'spawn-error']) {
    const child = Bun.spawn([process.execPath, runner, mode], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 15_000)
    try {
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      writeFileSync(join(run.directory, mode + '.log'), stdout + stderr)
      assert.equal(code, 0, stderr)
      const result = JSON.parse(readFileSync(join(run.directory, mode + '.json'), 'utf8'))
      assert(!result.aliveAtSettlement, 'Driver settled before process exit: ' + mode)
      assert(result.cwdRemoved)
      assert.equal(result.result, mode === 'success' ? 'resolved' : 'rejected')
      if (mode === 'early-exit') assert.match(result.error, /bundle exited early/)
      if (mode === 'timeout') assert.match(result.error, /timed out/)
      if (mode === 'spawn-error') assert.match(result.error, /ENOENT|not found/i)
      checks.push(mode)
    } finally { clearTimeout(timer) }
  }
  run.json('checks.json', checks)
  run.complete(checks, ['Real provider inference', 'Other operating systems', 'OS refusing to terminate an owned child process'])
})
