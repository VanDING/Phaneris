import { loadWorkspaceConfig, saveWorkspaceConfig } from './storage'
import type { AssistantMemoryPolicy } from './types'
import { CONFIG_FILE } from '../config/paths'
import { readJsonFileSync } from '../utils/files'
import { expandPath, resolveCanonicalPath } from '../utils/paths'

export interface AssistantMemoryPolicyStatus extends AssistantMemoryPolicy {
  configured: boolean
  valid: boolean
  reason: 'configuration_unavailable' | 'workspace_mismatch' | 'invalid_policy' | 'unconfigured' | 'disabled' | 'paused' | 'explicit' | 'automatic'
}

/** Old registration generated a second ID. Only the Host's registered identity
 * at this exact canonical root may use that legacy local config; IDs alone are
 * never aliases for other roots. Read the registry without startup side effects. */
function ownsWorkspaceConfig(workspace: { id: string; rootPath: string }, localId: unknown): boolean {
  if (typeof localId !== 'string' || !localId.length) return false
  if (localId === workspace.id) return true
  try {
    const registry = readJsonFileSync<{ workspaces: Array<{ id: string; rootPath: string }> }>(CONFIG_FILE)
    const root = resolveCanonicalPath(expandPath(workspace.rootPath))
    return registry.workspaces.some(entry => entry.id === workspace.id && resolveCanonicalPath(expandPath(entry.rootPath)) === root)
  } catch { return false }
}

export function parseAssistantMemoryPolicy(value: unknown): AssistantMemoryPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid assistant memory policy configuration')
  const policy = value as Record<string, unknown>
  if (policy.version !== 1 || typeof policy.learning !== 'string' || !['automatic', 'explicit', 'paused'].includes(policy.learning) || typeof policy.use !== 'boolean'
    || Object.keys(policy).some(key => !['version', 'learning', 'use'].includes(key))) throw new Error('Invalid assistant memory policy configuration')
  return { version: 1, learning: policy.learning as AssistantMemoryPolicy['learning'], use: policy.use }
}

/** Invalid or missing configuration cannot widen learning or use. Legacy absence keeps prior use only. */
export function readAssistantMemoryPolicy(workspace: { id: string; rootPath: string }): AssistantMemoryPolicyStatus {
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (!config) return { version: 1, learning: 'paused', use: false, configured: false, valid: false, reason: 'configuration_unavailable' }
  if (!ownsWorkspaceConfig(workspace, config.id)) return { version: 1, learning: 'paused', use: false, configured: false, valid: false, reason: 'workspace_mismatch' }
  if (config.assistantMemory === undefined) return { version: 1, learning: 'explicit', use: true, configured: false, valid: true, reason: 'unconfigured' }
  if (config.assistantMemory === false) return { version: 1, learning: 'paused', use: false, configured: true, valid: true, reason: 'disabled' }
  try {
    const policy = parseAssistantMemoryPolicy(config.assistantMemory)
    return { ...policy, configured: true, valid: true, reason: policy.learning }
  } catch { return { version: 1, learning: 'paused', use: false, configured: true, valid: false, reason: 'invalid_policy' } }
}

/** Every memory owner reports the same effective admission policy. */
export function assertAssistantMemoryLearning(policy: AssistantMemoryPolicyStatus, authority: 'automatic' | 'user_request'): void {
  if (!policy.valid) throw new Error(`Assistant memory configuration is invalid (${policy.reason})`)
  if (policy.learning === 'paused') throw new Error('Assistant memory learning is paused; an explicit memory request does not resume learning')
  if (authority === 'automatic' && policy.learning !== 'automatic') throw new Error('Assistant memory learning requires an explicit current user request')
}

/** Accepted native-memory defaults; preserve any explicit existing choice, including false. */
export function initializeAssistantMemoryPolicy(workspace: { id: string; rootPath: string }): void {
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (!config || !ownsWorkspaceConfig(workspace, config.id) || config.assistantMemory !== undefined) return
  config.assistantMemory = { version: 1, learning: 'automatic', use: true }
  saveWorkspaceConfig(workspace.rootPath, config)
}
