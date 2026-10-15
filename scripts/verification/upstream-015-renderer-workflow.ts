import assert from 'node:assert/strict'
import { join, relative, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'vite'
import rendererConfig from '../../apps/electron/vite.config'
import { build as buildNative } from 'esbuild'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upstream-015-renderer', async run => {
  const root = resolve(import.meta.dir,'../..'), fixture = join(root,'scripts/verification/fixtures/upstream-015-renderer.tsx')
  const html = join(run.directory,'index.html'), bundle = join(run.directory,'bundle')
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="${relative(run.directory,fixture).replaceAll('\\','/')}"></script>`)
  await build({ ...rendererConfig, configFile:false, root:run.directory,
    build:{...rendererConfig.build,outDir:bundle,emptyOutDir:false,sourcemap:false,rolldownOptions:{input:html}} })
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    const path = resolve(bundle,'.'+new URL(request.url).pathname)
    if(relative(bundle,path).startsWith('..')) return new Response(null,{status:403})
    const file = Bun.file(path.endsWith('\\') || new URL(request.url).pathname==='/' ? join(bundle,'index.html') : path)
    return await file.exists() ? new Response(file) : new Response(null,{status:404})
  }})
  try {
    const url = `http://127.0.0.1:${server.port}/index.html`
    run.json('progress.json',{stage:'server-listening',url})
    const entry = join(run.directory,'native-renderer.cjs')
    await buildNative({entryPoints:[join(import.meta.dir,'fixtures/upstream-015-renderer-native.ts')],bundle:true,platform:'node',format:'cjs',outfile:entry,external:['electron'],logLevel:'warning'})
    const electron = (await import('electron')).default as unknown as string
    const env: NodeJS.ProcessEnv = {...process.env,PHANERIS_CONFIG_DIR:join(run.directory,'profile'),PHANERIS_VERIFY_URL:url,PHANERIS_VERIFY_OUTPUT:run.directory}; delete env.ELECTRON_RUN_AS_NODE
    const child = Bun.spawn([electron,entry],{cwd:root,env,stdout:'pipe',stderr:'pipe'})
    const timer = setTimeout(()=>child.kill(),120_000)
    try {
      const [out,err,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
      writeFileSync(join(run.directory,'renderer-process.log'),out+err)
      const report = JSON.parse(readFileSync(join(run.directory,'upstream-015-renderer.json'),'utf8'))
      assert.equal(code,0,JSON.stringify(report)); run.complete(report.checks,['Native IME/touch','Live provider or OAuth accounts'])
    } finally {clearTimeout(timer)}
  } finally {server.stop(true)}
})
