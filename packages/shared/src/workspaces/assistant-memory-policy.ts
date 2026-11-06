import { loadWorkspaceConfig, saveWorkspaceConfig } from './storage'
import type { AssistantMemoryPolicy } from './types'

export function parseAssistantMemoryPolicy(value: unknown): AssistantMemoryPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid assistant memory policy configuration')
  const policy = value as Record<string, unknown>
  if (policy.version !== 1 || typeof policy.learning !== 'string' || !['automatic', 'explicit', 'paused'].includes(policy.learning) || typeof policy.use !== 'boolean'
    || Object.keys(policy).some(key => !['version', 'learning', 'use'].includes(key))) throw new Error('Invalid assistant memory policy configuration')
  return { version: 1, learning: policy.learning as AssistantMemoryPolicy['learning'], use: policy.use }
}

/** Invalid or missing configuration cannot widen learning or use. Legacy absence keeps prior use only. */
export function readAssistantMemoryPolicy(workspace: { id: string; rootPath: string }): AssistantMemoryPolicy & { configured: boolean; valid: boolean } {
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (!config || config.id !== workspace.id) return { version: 1, learning: 'paused', use: false, configured: false, valid: false }
  if (config.assistantMemory === undefined) return { version: 1, learning: 'explicit', use: true, configured: false, valid: true }
  if (config.assistantMemory === false) return { version: 1, learning: 'paused', use: false, configured: true, valid: true }
  try { return { ...parseAssistantMemoryPolicy(config.assistantMemory), configured: true, valid: true } }
  catch { return { version: 1, learning: 'paused', use: false, configured: true, valid: false } }
}

/** Accepted native-memory defaults; preserve any explicit existing choice, including false. */
export function initializeAssistantMemoryPolicy(workspace: { id: string; rootPath: string }): void {
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (!config || config.id !== workspace.id || config.assistantMemory !== undefined) return
  config.assistantMemory = { version: 1, learning: 'automatic', use: true }
  saveWorkspaceConfig(workspace.rootPath, config)
}
