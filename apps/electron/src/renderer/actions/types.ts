export type ActionScope = 'global' | 'navigator' | 'chat' | 'sidebar'

/**
 * Shortcut-page section. Closed on purpose: each value has a `shortcuts.category.*`
 * translation, and the page resolves it through a literal map so
 * `lint:i18n:coverage` can see the key. While this was `string`, the page built
 * `shortcuts.category.${category.toLowerCase()}` at runtime and a missing
 * translation shipped as the raw key text — exactly what happened to `Panels`.
 */
export type ActionCategory = 'General' | 'Navigation' | 'Navigator' | 'View' | 'Panels' | 'Chat'

export interface ActionDefinition {
  id: string
  label: string
  description?: string
  defaultHotkey: string | null  // null = no default hotkey
  category: ActionCategory
  scope?: ActionScope           // Default: 'global'
  /** When-clause expression controlling when the action fires.
   *  Omit = fires everywhere (default). Examples:
   *  - '!inputFocus'              — only outside text inputs
   *  - 'chatFocus && !hasSelection' — chat zone, no text selected
   *  - 'navigatorFocus'           — only when navigator is focused
   *  @see evaluateWhen() in keybinding-context.ts */
  when?: string
}

export type ActionId = keyof typeof import('./definitions').actions

export interface ActionHandler {
  actionId: ActionId
  handler: () => void
  enabled?: () => boolean
}
