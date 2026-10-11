const fs = require('node:fs'), cp = require('node:child_process'), crypto = require('node:crypto')
const { parse } = require('@babel/parser')
const old = path => cp.execFileSync('git', ['show', 'HEAD:' + path], { encoding: 'utf8' })
const ast = (source, jsx = false) => parse(source, { sourceType: 'module', plugins: ['typescript', ...(jsx ? ['jsx'] : [])] })
const storage = 'packages/shared/src/config/storage.ts', mapping = JSON.parse(fs.readFileSync('.cache/governance-completion/config-owner-map.json'))
const exportNodes = ast(old(storage)).program.body.filter(node => node.type === 'ExportNamedDeclaration')
const ports = exportNodes.flatMap(node => {
 if (node.declaration) { const d = node.declaration; return (d.id ? [d.id.name] : d.declarations?.map(item => item.id.name) ?? []).map(name => ({ name, typeOnly: node.exportKind === 'type', owner: mapping[name]?.domain, baselineLine: node.loc.start.line })) }
 return node.specifiers.map(specifier => ({ name: specifier.exported.name, typeOnly: node.exportKind === 'type' || specifier.exportKind === 'type', owner: node.source.value, baselineLine: node.loc.start.line }))
})
const consumers = new Map(ports.map(port => [port.name, []]))
const files = cp.execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(path => /^(apps|packages)\/.+\.(ts|tsx)$/.test(path) && !/(?:test|spec|isolated)\.tsx?$|\/(?:__tests__|fixtures)\//.test(path))
for (const file of files) {
 if (!fs.existsSync(file)) continue
 for (const node of ast(fs.readFileSync(file, 'utf8'), file.endsWith('.tsx')).program.body) {
  if (node.type !== 'ImportDeclaration' || !/config(?:\/|$)|@config\//.test(node.source.value)) continue
  for (const specifier of node.specifiers) { const name = specifier.imported?.name; if (consumers.has(name)) consumers.get(name).push({ file, line: node.loc.start.line, port: node.source.value }) }
 }
}
for (const port of ports) port.consumers = consumers.get(port.name)
const manager = 'packages/server-core/src/sessions/SessionManager.ts'
const members = source => ast(source).program.body.map(node => node.declaration ?? node).find(node => node.type === 'ClassDeclaration' && node.id.name === 'SessionManager').body.body.map(node => ({ name: node.key?.name ?? node.kind, kind: node.type, line: node.loc.start.line }))
const current = new Map(members(fs.readFileSync(manager, 'utf8')).map(member => [member.name, member]))
function classification(name) {
 if (/^(monotonic|lastTimestamp)$/.test(name)) return ['SessionManager 产品事件时钟', '保留产品事件时间戳，不属于 JSONL 队列或 Host 权威时钟']
 if (/^(persistSession|hydrateMessagesForColdPersist|enqueuePersist|flushSession|flushAllSessions|loadMessagesFromDisk)$/.test(name)) return ['product-repository.ts', '唯一 JSONL 持久化队列和产品 snapshot；Manager 保留调用适配，无第二队列']
 if (/Source|Mcp|Contributed|Plugin/.test(name)) return ['source-resources.ts + SessionManager 产品适配', 'HTTP/MCP lease 唯一创建、先 ready 后装配、幂等释放；选择和事件归产品层']
 if (/Agent|agentRefresh|AuthRetry/.test(name)) return ['agent-product-context.ts / agent-product-callbacks.ts / agent-assembly.ts + Runtime Host 调用端', '只读配置和有限 callbacks/resources 构造 backend；Host 安装/暂停/释放继续由调用端执行']
 if (/permission|Permission|Credential|credential|AskUser|Admin|privileged/i.test(name)) return ['SessionManager 授权/凭据适配 + broker', '既有 request registry 和策略归属；不复制授权 authority 或更改默认模式']
 if (/decision|Decision|Suggestion|Queued|Continuation|ContextHandoff|handoffStarts|TurnOutcome|PreTurn|MidTurn|Runtime|Execution|sendMessage|runSessionTurn|cancelProcessing|admitSessionInput|pauseSessionExecution|Reconcile|RecoveryEvidence/i.test(name)) return ['既有 Runtime Host + SessionManager 产品适配', '事实、输入准入、T1/T2、恢复、终态仍由 Host；产品层只保留投影和调用编排']
 if (/Event|Delta|Sink|Completion|PlanningChanged|rpcServer|LastMessageClient|ClientDisconnected|BrowserHost|remoteBpm|browserHost/i.test(name)) return ['SessionManager 客户端事件投影', '单一 push/delta/连接绑定；退出、断连和 flush 保留原有收口顺序']
 if (/Task|taskOutput|killShell|keepBackground|TaskRuntime/i.test(name)) return ['现有 TaskRunner/后台任务资源 + 产品适配', '任务资源不进入 agent assembler；不创建新执行队列或改变任务权限']
 if (/Automation|automation/i.test(name)) return ['现有 workspace AutomationSystem + 产品适配', '一 workspace 一系统；原 binder/loop guard/工具注册顺序保留']
 if (/initialize|Init|cleanup|idle|shuttingDown|loadSessionsFromDisk|registerManagedSession|releaseIdle|messageLoadingPromises/i.test(name)) return ['SessionManager 生命周期和产品缓存', '初始化 promise、按 session 合并加载、idle eviction 与全局退出保持单 owner']
 if (/Watcher|Config|Theme/i.test(name)) return ['现有 ConfigWatcher + 配置 domain owner', '监听句柄由 workspace/process 生命周期管理；配置写入统一 repository']
 if (/Browser|browserPane|terminalReader|Thumbnail/i.test(name)) return ['已注册客户端/宿主 capability port', '浏览器、终端和缩略图仍是外部资源；禁止装配器引用完整 Manager']
 return ['SessionManager 产品 API/metadata 适配', '用户可见会话字段、筛选、已读、分享和迁移保留产品 owner；IO 委托原存储/新 repository']
}
const managerMembers = members(old(manager)).map(member => { const [owner, reason] = classification(member.name); return { ...member, currentLine: current.get(member.name)?.line ?? null, owner, reason } })
const warnings = JSON.parse(fs.readFileSync('scripts/lint-warning-baseline.json')).entries.filter(entry => /no-localstorage/.test(entry.rule))
const localStorage = warnings.map(row => ({ ...row, classification: row.file.includes('/playground/') ? '开发 playground 的设备展示状态；不进入生产 workspace/Host 事实' : '设备/窗口展示偏好缓存；不能持有 credential、RPC auth 或 canonical runtime 事实' }))
const report = { schemaVersion: 1, baselineHead: cp.execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), config: { exportDeclarations: exportNodes.length, publicPorts: ports.length, ports }, manager: { methods: managerMembers.filter(row=>/Method$/.test(row.kind)).length, fields: managerMembers.filter(row=>/Property$/.test(row.kind)).length, currentMethods: [...current.values()].filter(row=>/Method$/.test(row.kind)).length, currentFields: [...current.values()].filter(row=>/Property$/.test(row.kind)).length, members: managerMembers }, dependencies: JSON.parse(fs.readFileSync('.cache/governance-completion/dependency-owners.json')), localStorage, cycles: { original: JSON.parse(fs.readFileSync('docs/verification/results/architecture-code-governance-2026-10-11/import-graph.json')).fileCycleCandidates, currentRuntime: JSON.parse(fs.readFileSync('.cache/governance-closeout/graph-final.json')).valueFileCycleCandidates }, baselineSha256: {storage: crypto.createHash('sha256').update(old(storage)).digest('hex'), manager: crypto.createHash('sha256').update(old(manager)).digest('hex')} }
fs.writeFileSync('.cache/governance-closeout/ownership-inventory.json', JSON.stringify(report, null, 2)+'\n')
console.log(JSON.stringify({configExportDeclarations:exportNodes.length,publicPorts:ports.length,managerMethods:report.manager.methods,managerFields:report.manager.fields,localStorageWarnings:localStorage.reduce((n,row)=>n+row.count,0),dependencies:report.dependencies.length}))
