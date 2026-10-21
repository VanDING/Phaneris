#!/usr/bin/env bun
/** Reproducible public method census from the actual channel, handler and client map sources. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RPC_CHANNELS, LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS, RPC_INPUT_CONTRACTS } from '../packages/shared/src/protocol'
import { scanImportGraph, memberName } from './lib/import-graph'
import type { Node } from '@babel/types'

const root = resolve(import.meta.dir, '..')
const output = resolve(root, 'scripts/rpc-contract-inventory.json')
const update = process.argv.includes('--update')
const channels = Object.entries(RPC_CHANNELS).flatMap(([domain, members]) => Object.entries(members).map(([key, channel]) => ({ key: `${domain}.${key}`, channel, domain })))
const channelByKey = new Map(channels.map(row => [row.key, row.channel]))
const knownChannels = new Set<string>(channels.map(row => row.channel))
const reserved = JSON.parse(readFileSync(resolve(root, 'scripts/rpc-reserved-surfaces.json'), 'utf8')) as {
  surfaces: { channel: string; kind: string; owner: string; reason: string }[]
}
const reservedByChannel = new Map(reserved.surfaces.map(row => [row.channel, row]))
const resultPorts = readFileSync(resolve(root, 'packages/shared/src/protocol/method-contracts.ts'), 'utf8')
const typedResults = new Map([...resultPorts.matchAll(/\[c\.([\w.]+)\]:\s*([^\n]+)/g)].map(match => [channelByKey.get(match[1]!)!, match[2]!]))
const sites = new Map<string, { file: string; line: number; args: string[]; result: string; owner: string }[]>()
const events = new Set<string>()
function expressionPath(node: Node | undefined): string | undefined {
  if (node?.type === 'Identifier') return node.name
  if (node?.type !== 'MemberExpression' && node?.type !== 'OptionalMemberExpression') return
  const object = expressionPath(node.object), property = memberName(node)
  return object && property ? `${object}.${property}` : undefined
}
scanImportGraph(root, { onNode(ctx, node) {
  if (node.type !== 'CallExpression') return
  const method = memberName(node.callee)
  const target = expressionPath(node.arguments?.[0])?.replace(/^RPC_CHANNELS\./, '')
  const argument = node.arguments[0]
  const channel = target ? channelByKey.get(target) : argument?.type === 'StringLiteral' && knownChannels.has(argument.value) ? argument.value : undefined
  if (!channel) return
  if (method === 'listener' || method === 'pushTyped' || method === 'push') events.add(channel)
  if (method !== 'handle') return
  const callback = node.arguments[1]
  const fn = callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression' ? callback : undefined
  const params = fn?.params.slice(1).map(param => ctx.code.slice(param.start ?? 0, param.end ?? undefined)) ?? ['named handler; see source']
  const text = callback?.start != null ? ctx.code.slice(callback.start, callback.end ?? undefined) : ''
  const owner = text.includes('assertSessionWorkspaceOwnership') ? 'session workspace guard'
    : text.includes('assertTransferOwner') ? 'client-owned transfer'
    : text.includes('requireWorkspace') || text.includes('getWorkspaceByNameOrId') ? 'explicit destination workspace'
    : ctx.name.includes('/files.ts') ? 'validated file target / existing path policy'
    : 'authenticated host or handler-specific policy'
  if (!sites.has(channel)) sites.set(channel, [])
  sites.get(channel)!.push({ file: ctx.name, line: node.loc?.start.line ?? 0, args: params,
    result: fn?.returnType ? ctx.code.slice(fn.returnType.start ?? 0, fn.returnType.end ?? undefined).replace(/^:\s*/, '') : 'inferred by TypeScript; see handler return', owner })
} })
// The client map gives an authoritative distinction between invocations and subscriptions.
const map = readFileSync(resolve(root, 'apps/electron/src/transport/channel-map.ts'), 'utf8')
for (const match of map.matchAll(/listener\(RPC_CHANNELS\.([\w.]+)\)/g)) { const channel = channelByKey.get(match[1]!); if (channel) events.add(channel) }
const rows = channels.map(row => ({ ...row,
  routing: LOCAL_ONLY_CHANNELS.has(row.channel) ? 'local-only' : REMOTE_ELIGIBLE_CHANNELS.has(row.channel) ? 'remote-eligible' : 'UNCLASSIFIED',
  kind: events.has(row.channel) && !sites.has(row.channel) ? 'event' : sites.has(row.channel) ? 'method' : reservedByChannel.get(row.channel)?.kind ?? 'UNCLASSIFIED',
  ...(reservedByChannel.has(row.channel) ? { surfaceDecision: reservedByChannel.get(row.channel) } : {}),
  runtimeValidation: RPC_INPUT_CONTRACTS[row.channel] ? 'protocol input contract + existing domain checks' : 'existing handler/capability checks; no centralized schema',
  resultContract: typedResults.get(row.channel) ?? (events.has(row.channel) ? 'authoritative BroadcastEventMap / existing capability event payload' : 'unknown transport extension; narrowed by existing typed client facade or handler consumer'),
  compatibility: 'stable wire string; unknown fields preserved; timeout abandons response without effect retry',
  sites: (sites.get(row.channel) ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
})).sort((a, b) => a.channel.localeCompare(b.channel))
if (rows.length !== 428 || rows.some(row => row.routing === 'UNCLASSIFIED')) throw new Error('Incomplete RPC channel routing census')
if (!sites.size) throw new Error('RPC handler census is empty')
if (rows.some(row => row.kind === 'UNCLASSIFIED')) throw new Error('RPC surface without a handler, event producer or explicit reservation')
for (const channel of reservedByChannel.keys()) {
  if (!knownChannels.has(channel) || sites.has(channel) || events.has(channel)) throw new Error(`Stale reserved surface decision: ${channel}`)
}
for (const channel of Object.keys(RPC_INPUT_CONTRACTS)) {
  if (!sites.has(channel)) throw new Error(`Central input contract has no resolved handler: ${channel}`)
}
const json = JSON.stringify({ schemaVersion: 2, channels: rows.length, centrallyValidatedMethods: Object.keys(RPC_INPUT_CONTRACTS).length, typedResultPorts: typedResults.size, rows }, null, 2) + '\n'
if (update) writeFileSync(output, json)
else if (readFileSync(output, 'utf8') !== json) throw new Error('RPC contract inventory is stale; inspect changes and run bun run scripts/contract-inventory.ts --update')
console.log(`RPC contracts OK: ${rows.length} channels; ${Object.keys(RPC_INPUT_CONTRACTS).length} validated input contracts`)
