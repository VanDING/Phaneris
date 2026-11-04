import { getLlmConnections, getLlmConnection } from '@phaneris/shared/config/connections'
import { getModelById } from '@phaneris/shared/config/models'
import { loadWorkspaceSources, isSourceUsable } from '@phaneris/shared/sources'
import { loadAllSkills } from '@phaneris/shared/skills'
import { loadAllPlugins } from '@phaneris/shared/plugins'
import { loadWorkspaceProjects, loadProjectById } from '@phaneris/shared/projects'
import type { PermissionMode } from '@phaneris/shared/agent/mode-types'
import type { WorkerOptionsQuery, WorkerOptionsPage } from '@phaneris/session-tools-core/delegation-contracts'
import { EXECUTION_PROMPT_PRESETS } from '@phaneris/core/types'
import { createHash } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'

/** Deliberate metadata projection: never serialize connection objects or source credentials. */
export function readWorkerOptions(workspaceRoot: string, query: WorkerOptionsQuery, permissionCeiling: PermissionMode): WorkerOptionsPage {
  let items: Array<Record<string, unknown>>
  switch (query.kind) {
    case 'presets': items = EXECUTION_PROMPT_PRESETS.map(id => ({ id, description: id === 'mini' ? 'Focused configuration edits' : 'Full ordinary Session execution' })); break
    case 'connections': items = getLlmConnections().map(connection => ({ slug: connection.slug, name: connection.name, defaultModel: connection.defaultModel, modelCount: connection.models?.length ?? 0 })); break
    case 'models': {
      const connection = query.connectionSlug ? getLlmConnection(query.connectionSlug) : null
      if (!connection) throw new Error('Select an installed connection to list its models')
      items = (connection.models ?? []).map(model => {
        const definition = typeof model === 'string' ? getModelById(model) : model
        return { id: typeof model === 'string' ? model : model.id, name: definition?.name,
          supportsThinking: definition?.supportsThinking,
          supportedThinkingLevels: definition?.supportsThinking === false ? ['off'] : definition?.supportedThinkingLevels,
          thinkingLevelMap: definition?.thinkingLevelMap }
      })
      break
    }
    case 'sources': items = loadWorkspaceSources(workspaceRoot).map(source => ({ slug: source.config.slug, name: source.config.name, type: source.config.type, usable: isSourceUsable(source) })); break
    case 'skills': {
      const project = query.projectId ? loadProjectById(workspaceRoot, query.projectId) : null
      if (query.projectId && !project) throw new Error('Project not found in this workspace')
      items = loadAllSkills(workspaceRoot, project?.config.workingDirectory).map(skill => ({ slug: skill.slug, name: skill.metadata.name, description: skill.metadata.description, requiredSources: skill.metadata.requiredSources }))
      break
    }
    case 'plugins': items = loadAllPlugins(workspaceRoot).plugins.map(plugin => ({ name: plugin.name,
      sources: [...plugin.resources.mcpServers, ...plugin.resources.extensionSources].map(source => source.slug),
      skills: plugin.resources.skills.map(skill => skill.slug), warnings: plugin.warnings.map(warning => warning.message) })); break
    case 'projects': items = loadWorkspaceProjects(workspaceRoot).filter(project => !project.config.archivedAt).map(project => ({ id: project.config.id, name: project.config.name, workingDirectory: project.config.workingDirectory })); break
  }
  const offset = query.offset ?? 0, limit = query.limit ?? 20
  items.sort((a, b) => String(a.id ?? a.slug ?? a.name).localeCompare(String(b.id ?? b.slug ?? b.name)))
  const catalogRevision = createHash('sha256').update(canonicalJson({ kind: query.kind, connectionSlug: query.connectionSlug, projectId: query.projectId, items, permissionCeiling })).digest('hex')
  if (query.expectedRevision && query.expectedRevision !== catalogRevision) throw new Error('Worker catalog revision changed; restart discovery')
  return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null, catalogRevision, permissionCeiling }
}
