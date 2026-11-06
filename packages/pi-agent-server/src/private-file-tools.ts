import { resolve, relative } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { AssistantPrivatePaths, resolveFileToolPath } from '@phaneris/shared/agent/assistant-private-paths'

type FilePrincipal = { kind: 'resident_assistant'; sessionId: string }
export function privateSafeLsOperations(workspaceRoot: string, principal?: FilePrincipal) {
  return { exists: existsSync, stat, readdir: async (path: string) => {
    const policy = new AssistantPrivatePaths(workspaceRoot, principal)
    policy.assertPublic(path)
    return (await readdir(path)).filter(name => !policy.isPrivate(resolve(path, name)))
  } }
}

/** Keep SDK schemas, cancellation and search implementation; partition only protected ancestors. */
export function protectPrivateFileTools(tools: ToolDefinition<any, any>[], workspaceRoot: string, cwd: string, principal?: FilePrincipal): ToolDefinition<any, any>[] {
  return tools.map(tool => ({ ...tool, execute: async (id, input, signal, update, context) => {
    const args = input as { path?: string; limit?: number }
    const policy = new AssistantPrivatePaths(workspaceRoot, principal)
    const root = resolveFileToolPath(context?.cwd ?? cwd, args.path ?? '.')
    if (['write', 'edit'].includes(tool.name.toLowerCase())) policy.assertWritable(root)
    else policy.assertPublic(root)
    if (!['grep', 'find'].includes(tool.name)) return tool.execute(id, args, signal, update, context)
    const roots = policy.searchRoots(root)
    if (roots.length === 1 && roots[0] === root) return tool.execute(id, args, signal, update, context)
    const parts: string[] = [], defaultLimit = tool.name === 'find' ? 1000 : 100
    let remaining = Math.max(1, args.limit ?? defaultLimit), chars = 0
    for (const path of roots) {
      if (signal?.aborted) throw new Error('Operation aborted')
      const result = await tool.execute(id, { ...args, path, limit: remaining }, signal, undefined, context)
      const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (/^No (?:matches|files) found/.test(text)) continue
      const lines = text.split('\n')
      if (tool.name === 'find') {
        const prefix = relative(root, path).replaceAll('\\', '/')
        parts.push(lines.map(line => line && !line.startsWith('[') ? `${prefix}/${line}` : line).join('\n'))
        remaining -= lines.filter(line => line && !line.startsWith('[')).length
      } else {
        parts.push(`[${path}]\n${text}`)
        remaining -= lines.filter(line => /^.*:\d+:/.test(line)).length
      }
      chars += text.length
      if (remaining <= 0 || chars >= 48_000) break
    }
    const text = parts.join('\n').slice(0, 50_000) || (tool.name === 'find' ? 'No files found.' : 'No matches found.')
    return { content: [{ type: 'text', text: text + (remaining <= 0 || chars >= 48_000 ? '\n[Search output limit reached.]' : '') }], details: undefined }
  } }))
}
