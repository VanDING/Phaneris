import { isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { SessionDelegationPlan } from './delegation'
import { resolveBackendContext } from '@phaneris/shared/agent/backend'
import { getLlmConnection, getDefaultThinkingLevel } from '@phaneris/shared/config/connections'
import { getModelById } from '@phaneris/shared/config/models'
import { loadWorkspaceConfig } from '@phaneris/shared/workspaces'
import { loadProjectById } from '@phaneris/shared/projects'
import { loadSkillBySlug } from '@phaneris/shared/skills'
import { loadPluginByName } from '@phaneris/shared/plugins'
import { getSourcesBySlugs, isSourceUsable } from '@phaneris/shared/sources'
import { clampPermissionMode, type PermissionMode } from '@phaneris/shared/agent/mode-types'
import type { WorkerConfig, EffectiveWorkerConfig } from '@phaneris/session-tools-core/delegation-contracts'

/** Resolve once before creating work; explicit choices never silently fall back. */
export function resolveWorkerConfig(
  workspace: { rootPath: string }, requested: WorkerConfig,
  parent: { llmConnection?: string; model?: string; thinkingLevel?: EffectiveWorkerConfig['thinkingLevel']; permissionMode: PermissionMode; projectId?: string },
  capabilityKey: Uint8Array,
): SessionDelegationPlan {
  const defaults = loadWorkspaceConfig(workspace.rootPath)?.defaults
  if (requested.llmConnection && !getLlmConnection(requested.llmConnection)) throw new Error('Worker connection not found')
  const backend = resolveBackendContext({ sessionConnectionSlug: requested.llmConnection ?? parent.llmConnection,
    workspaceDefaultConnectionSlug: defaults?.defaultLlmConnection,
    managedModel: requested.model ?? (requested.llmConnection ? undefined : parent.model) ?? defaults?.model })
  const connection = backend.connection
  if (!connection) throw new Error('Worker requires a configured connection')
  const selected = requested.model ?? (requested.llmConnection ? connection.defaultModel : parent.model) ?? connection.defaultModel ?? backend.resolvedModel
  const modelId = selected.replace(/^pi\//, '')
  const model = connection.models?.find(item => (typeof item === 'string' ? item : item.id) === modelId)
  if (!model) throw new Error(`Worker model is not in the selected connection catalog: ${modelId}`)
  const definition = typeof model === 'string' ? getModelById(model) : model
  const adjustments: string[] = []
  const knownLevels = definition?.supportedThinkingLevels
  const hasThinkingCatalog = definition?.supportsThinking === false || !!knownLevels?.length || !!definition?.thinkingLevelMap
  const defaultThinking = parent.thinkingLevel ?? getDefaultThinkingLevel()
  const thinkingLevel = requested.thinkingLevel ?? (definition?.supportsThinking === false || !hasThinkingCatalog ? 'off' : defaultThinking)
  if (!requested.thinkingLevel && !hasThinkingCatalog && defaultThinking !== 'off') adjustments.push('thinkingLevel: off (selected model has no verified thinking-level catalog)')
  if (thinkingLevel !== 'off' && !knownLevels?.includes(thinkingLevel) && !definition?.thinkingLevelMap?.[thinkingLevel]) throw new Error(`Worker thinking capability is unverified for ${thinkingLevel}; refresh the model catalog or select off`)
  if ((definition?.supportsThinking === false && thinkingLevel !== 'off')
    || (definition?.supportedThinkingLevels && !definition.supportedThinkingLevels.includes(thinkingLevel))
    || definition?.thinkingLevelMap?.[thinkingLevel] === null) throw new Error(`Worker model does not support thinking level: ${thinkingLevel}`)
  const permissionMode = clampPermissionMode(requested.permissionMode, parent.permissionMode)
  if (requested.permissionMode && permissionMode !== requested.permissionMode) adjustments.push(`permissionMode: ${requested.permissionMode} -> ${permissionMode} (assistant ceiling)`)
  const projectId = requested.projectId ?? parent.projectId
  const project = projectId ? loadProjectById(workspace.rootPath, projectId) : null
  if (projectId && !project) throw new Error('Worker project not found in this workspace')
  const workingDirectory = requested.workingDirectory === 'none' ? 'none'
    : !requested.workingDirectory || requested.workingDirectory === 'user_default'
      ? project?.config.workingDirectory ?? defaults?.workingDirectory ?? 'none' : requested.workingDirectory
  if (workingDirectory !== 'none' && (!isAbsolute(workingDirectory) || !statSync(workingDirectory, { throwIfNoEntry: false })?.isDirectory())) throw new Error('Worker workingDirectory must be an existing absolute Host directory')
  const skillSlugs = [...new Set(requested.skillSlugs ?? [])]
  const sources = new Set(requested.enabledSourceSlugs ?? [])
  const selectedSkills = []
  for (const slug of skillSlugs) {
    const skill = loadSkillBySlug(workspace.rootPath, slug, workingDirectory === 'none' ? undefined : workingDirectory)
    if (!skill) throw new Error(`Worker skill not found: ${slug}`)
    selectedSkills.push({ slug, metadata: skill.metadata, content: skill.content, path: skill.path, source: skill.source })
    for (const dependency of skill.metadata.requiredSources ?? []) sources.add(dependency)
  }
  const plugin = requested.activePlugin ? loadPluginByName(workspace.rootPath, requested.activePlugin) : null
  if (requested.activePlugin) {
    if (!plugin) throw new Error(`Worker plugin not found: ${requested.activePlugin}`)
    adjustments.push(...plugin.warnings.map(warning => `Plugin warning: ${warning.message}`))
    for (const source of [...plugin.resources.mcpServers, ...plugin.resources.extensionSources]) sources.add(source.slug)
  }
  const loaded = getSourcesBySlugs(workspace.rootPath, [...sources])
  for (const slug of sources) if (!loaded.some(source => source.config.slug === slug && isSourceUsable(source))) throw new Error(`Worker source unavailable: ${slug}`)
  const config: EffectiveWorkerConfig = { llmConnection: connection.slug, model: modelId, thinkingLevel, permissionMode,
    systemPromptPreset: requested.systemPromptPreset ?? 'default',
    enabledSourceSlugs: [...sources], skillSlugs, activePlugin: requested.activePlugin ?? null,
    projectId: project?.config.id, workingDirectory, contextPolicy: requested.contextPolicy ?? 'compact', labels: requested.labels ?? [] }
  // The service owns the key; resolving configuration only reads resources.
  const capabilityRevision = createHmac('sha256', capabilityKey).update(canonicalJson({ format: 1,
    preset: config.systemPromptPreset,
    connection: { slug: connection.slug, providerType: connection.providerType, piAuthProvider: connection.piAuthProvider,
      authType: connection.authType, baseUrl: connection.baseUrl, customEndpoint: connection.customEndpoint }, model: definition ?? model,
    project: project ? { id: project.config.id, name: project.config.name, description: project.config.description,
      details: project.config.details, workingDirectory: project.config.workingDirectory, archivedAt: project.config.archivedAt } : null, skills: selectedSkills,
    plugin: plugin ? { name: plugin.name, manifest: plugin.manifest, resources: plugin.resources, path: plugin.path, prompt: plugin.promptFragment } : null,
    sources: loaded.map(({ config: source, guide }) => ({ id: source.id, slug: source.slug, name: source.name, enabled: source.enabled,
      provider: source.provider, type: source.type, mcp: source.mcp, api: source.api, local: source.local, pluginRoot: source.pluginRoot, guide: guide?.raw })),
  })).digest('hex')
  return { config, adjustments, configRevision: createHash('sha256').update(canonicalJson(config)).digest('hex'), capabilityRevision }
}
