const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const JSON5 = require('json5');
const semver = require('semver');
const root = process.cwd();
const out = path.join(root, '.cache/upgrade-20261018');
const lock = JSON5.parse(fs.readFileSync('bun.lock', 'utf8'));
const manifests = ['package.json', ...['apps','packages'].flatMap(dir => fs.readdirSync(dir, {withFileTypes:true}).filter(e=>e.isDirectory() && fs.existsSync(path.join(dir,e.name,'package.json'))).map(e=>path.join(dir,e.name,'package.json').replaceAll('\\','/')))];
const declarations = [], internal = [];
for (const file of manifests) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if(file!=='package.json')internal.push({name:m.name,version:m.version,file});
  for(const field of ['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides','patchedDependencies'])
    for(const [name,range] of Object.entries(m[field]??{}))
      declarations.push({ecosystem:'npm',file,field,name:field==='patchedDependencies'?name.replace(/@[^@]+$/,''):name,range,internal:range.startsWith('workspace:')});
}
const instances = Object.entries(lock.packages).map(([location,entry]) => {
  const match = entry[0].match(/^((?:@[^/]+\/)?[^@]+)@(.+)$/);
  if(!match)throw new Error('Unrecognized '+entry[0]);
  return {location,name:match[1],version:match[2],source:typeof entry[1] === 'string' ? entry[1] : match[2],meta:typeof entry[1] === 'object' ? entry[1] : entry[2]};
}).filter(x=>!x.version.startsWith('workspace:'));
const names=[...new Set(instances.map(x=>x.name))].sort();
const python = [];
for(const file of fs.readdirSync('apps/electron/resources/scripts').filter(f=>f.endsWith('.py'))) {
  const full='apps/electron/resources/scripts/'+file;
  const text=fs.readFileSync(full,'utf8');
  const block=text.match(/# \/\/\/ script[\s\S]*?# \/\/\//)?.[0]??'';
  for(const m of block.matchAll(/["']([a-zA-Z0-9_-]+)(?:\[([^\]]+)\])?==([^"']+)["']/g))
    python.push({ecosystem:'pypi',file:full,field:'PEP723',name:m[1].toLowerCase().replaceAll('_','-'),extras:m[2]??'',range:m[3]});
}
const parents = {};
for(const i of instances)for(const [name,range]of Object.entries({...i.meta.dependencies,...i.meta.optionalDependencies,...i.meta.peerDependencies}))
  (parents[name]??=[]).push({parent:i.name+'@'+i.version,range});
const input={startedAt:new Date().toISOString(),commit:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),manifests,declarations,internal,instances,python,parents};
fs.writeFileSync(path.join(out,'inventory-before.json'),JSON.stringify(input,null,2));
const metadata={},errors=[];
async function get(url) {
  for(let attempt=0;attempt<3;attempt++){
    try{const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Phaneris-dependency-inventory'},signal:AbortSignal.timeout(40000)});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}
    catch(e){if(attempt===2)throw e;}
  }
}
async function pool(items,limit,fn){let cursor=0,done=0;await Promise.all(Array.from({length:limit},async()=>{for(;;){const index=cursor++;if(index>=items.length)return;const item=items[index];try{await fn(item)}catch(e){errors.push({item,error:String(e)})}done++;if(done%100===0)console.log(done+'/'+items.length);}}));}
(async()=>{
 await pool(names,10,async name=>{
  const source='https://registry.npmjs.org/'+encodeURIComponent(name);
  const data=await get(source);
  const stable=Object.keys(data.versions??{}).filter(v=>semver.valid(v)&&!semver.prerelease(v)&&!data.versions[v].deprecated).sort(semver.rcompare);
  const current=[...new Set(instances.filter(i=>i.name===name).map(i=>i.version))];
  const ranges=[...new Set([...declarations.filter(d=>d.name===name).map(d=>d.range),...(parents[name]??[]).map(p=>p.range)])].filter(r=>semver.validRange(r));
  const compatible=Object.fromEntries(ranges.map(r=>[r,semver.maxSatisfying(stable,r)]));
  const versions=[...new Set([...current,data['dist-tags']?.latest,stable[0],...Object.values(compatible)].filter(Boolean))];
  const selected=Object.fromEntries(versions.filter(v=>data.versions[v]).map(v=>{const m=data.versions[v];return [v,{publishedAt:data.time?.[v],deprecated:m.deprecated,engines:m.engines,peerDependencies:m.peerDependencies,dependencies:m.dependencies,optionalDependencies:m.optionalDependencies,repository:m.repository,dist:{tarball:m.dist?.tarball,integrity:m.dist?.integrity},license:m.license}]}));
  metadata[name]={source,checkedAt:new Date().toISOString(),distTags:data['dist-tags'],latestStable:stable[0]??null,repository:data.repository,homepage:data.homepage,current,compatible,versions:selected};
  if(Object.keys(metadata).length%100===0)fs.writeFileSync(path.join(out,'npm-metadata.json'),JSON.stringify(metadata));
 });
 fs.writeFileSync(path.join(out,'npm-metadata.json'),JSON.stringify(metadata,null,2));
 const pypi={};
 await pool([...new Set(python.map(d=>d.name))],5,async name=>{
  const source='https://pypi.org/pypi/'+name+'/json',j=await get(source);
  pypi[name]={source,checkedAt:new Date().toISOString(),latest:j.info.version,requiresPython:j.info.requires_python,requiresDist:j.info.requires_dist,projectUrls:j.info.project_urls,publishedAt:j.urls?.[0]?.upload_time_iso_8601,vulnerabilities:j.vulnerabilities,releases:Object.fromEntries(Object.entries(j.releases).map(([v,files])=>[v,{publishedAt:files[0]?.upload_time_iso_8601,requiresPython:files[0]?.requires_python,yanked:files.every(f=>f.yanked)}]))};
 });
 fs.writeFileSync(path.join(out,'pypi-metadata.json'),JSON.stringify(pypi,null,2));
 fs.writeFileSync(path.join(out,'metadata-errors.json'),JSON.stringify(errors,null,2));
 console.log(JSON.stringify({npmNames:names.length,npmResolved:Object.keys(metadata).length,pypiNames:Object.keys(pypi).length,errors}));
})().catch(e=>{console.error(e);process.exitCode=1});


