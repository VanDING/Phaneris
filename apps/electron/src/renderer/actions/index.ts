// Re-export everything for convenient imports
export { ActionRegistryProvider, useActionRegistry } from './registry'
export { useAction } from './useAction'
export { useHotkeyLabel, useActionLabel } from './useHotkeyLabel'
export { actions, actionList, actionsByCategory, ACTION_CATEGORY_LABEL_KEYS, type ActionId } from './definitions'
export type { ActionCategory, ActionDefinition, ActionHandler, ActionScope } from './types'
