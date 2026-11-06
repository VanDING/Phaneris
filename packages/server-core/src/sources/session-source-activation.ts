import type { AgentBackend } from '@phaneris/shared/agent/backend'
import { getSourcesBySlugs, isSourceUsable, loadSource, type TokenRefreshManager, type LoadedSource } from '@phaneris/shared/sources'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { Logger } from '../runtime'
import { buildServersFromSources } from './build-servers'

type BuiltSources = Awaited<ReturnType<typeof buildServersFromSources>>
export interface SessionSourceSnapshot {
  mcpServers: BuiltSources['mcpServers']; apiServers: BuiltSources['apiServers']; intendedSlugs: string[]
}
interface SourceActivationOwner {
  workspaceRootPath: string
  sessionPath(): string
  enabled(): string[]
  select(slugs: string[]): void
  backend: Pick<AgentBackend, 'setSourceServers' | 'getSummarizeCallback'>
  tokenRefreshManager(): TokenRefreshManager | undefined
  lease(): { valid(): boolean; owned(): boolean }
  isConnected(slug: string): boolean
  applied(snapshot: SessionSourceSnapshot): void
  invalidate(): void
  changed(): void
  log: Logger
}

function connectionIdentity(source: LoadedSource): string {
  const { id, provider, type, mcp, api, local, pluginRoot } = source.config
  return canonicalJson({ id, provider, type, mcp, api, local, pluginRoot })
}

/** Serializes connection changes, pins task ownership, and commits one runtime snapshot. */
export function createSessionSourceActivation(owner: SourceActivationOwner): (slug: string) => Promise<boolean> {
  let pending = Promise.resolve()
  return slug => {
    const lease = owner.lease()
    const operation = pending.then(async () => {
      const source = loadSource(owner.workspaceRootPath, slug)
      if (!lease.valid() || !source || !isSourceUsable(source)) return false
      const identity = connectionIdentity(source), previous = owner.enabled()
      const selected = previous.includes(slug) ? previous : [...previous, slug]
      if (selected !== previous) owner.select(selected)
      const current = () => {
        const fresh = loadSource(owner.workspaceRootPath, slug)
        return lease.valid() && !!fresh && isSourceUsable(fresh) && connectionIdentity(fresh) === identity
      }
      const build = async () => {
        const selection = owner.enabled()
        const sources = getSourcesBySlugs(owner.workspaceRootPath, selection).filter(isSourceUsable)
        const built = await buildServersFromSources(sources, owner.sessionPath(), owner.tokenRefreshManager(), owner.backend.getSummarizeCallback())
        return { ...built, intendedSlugs: sources.map(source => source.config.slug), selection }
      }
      const rollback = async () => {
        // Preserve a later explicit selection instead of overwriting it.
        if (selected !== previous && owner.enabled() === selected) owner.select(previous)
        owner.invalidate()
        if (lease.owned()) {
          const remaining = await build()
          if (owner.enabled() === remaining.selection && lease.owned()) {
            await owner.backend.setSourceServers(remaining.mcpServers, remaining.apiServers, remaining.intendedSlugs)
            if (owner.enabled() === remaining.selection && lease.owned()) owner.applied(remaining)
          }
        }
        owner.changed()
        return false
      }
      try {
        const built = await build()
        if (!current() || owner.enabled() !== built.selection) return await rollback()
        if (source.config.type !== 'local' && !(slug in built.mcpServers || slug in built.apiServers)) return await rollback()
        await owner.backend.setSourceServers(built.mcpServers, built.apiServers, built.intendedSlugs)
        if (!current() || owner.enabled() !== built.selection || source.config.type !== 'local' && !owner.isConnected(slug)) return await rollback()
        owner.applied(built)
        owner.changed()
        return true
      } catch (error) {
        owner.log.warn('Source activation failed:', slug, error)
        return rollback().catch(rollbackError => { owner.log.warn('Source rollback needs recovery:', rollbackError); return false })
      }
    })
    pending = operation.then(() => {}, () => {})
    return operation
  }
}
