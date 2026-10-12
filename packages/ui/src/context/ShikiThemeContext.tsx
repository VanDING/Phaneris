/**
 * ShikiThemeContext - Provides the current Shiki syntax highlighting theme to code blocks
 *
 * This context solves a theming edge case: when a dark-only theme (like Ghostty) is used
 * with system mode set to "auto" and the OS in light mode, the DOM has class "light" but
 * the code blocks should still use the dark shiki theme (e.g., vitesse-dark).
 *
 * Without this context, CodeBlock would check document.documentElement.classList and
 * incorrectly use github-light instead of the theme's configured shiki theme.
 *
 * The shikiTheme value comes from useTheme() which correctly handles:
 * - Theme's shikiTheme config (e.g., { light: 'github-light', dark: 'vitesse-dark' })
 * - Theme's supportedModes (dark-only themes use dark shiki even in "light" system mode)
 * - Scenic mode (forces dark)
 */

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'

interface ShikiThemeContextValue {
  /**
   * The current Shiki theme name to use for syntax highlighting.
   * Examples: 'github-light', 'github-dark', 'vitesse-dark', 'one-dark-pro'
   */
  shikiTheme: string | null
  revision?: string
}

const ShikiThemeContext = createContext<ShikiThemeContextValue>({ shikiTheme: null })

export interface ShikiThemeProviderProps {
  children: ReactNode
  /**
   * The Shiki theme name from useTheme(). Pass null to use default DOM-based detection.
   */
  shikiTheme: string | null
  revision?: string
}

/**
 * ShikiThemeProvider - Wraps components to provide the correct Shiki theme
 *
 * Usage:
 * ```tsx
 * const { shikiTheme } = useTheme({ appTheme })
 *
 * <ShikiThemeProvider shikiTheme={shikiTheme}>
 *   <SessionViewer />
 * </ShikiThemeProvider>
 * ```
 */
export function ShikiThemeProvider({ children, shikiTheme, revision }: ShikiThemeProviderProps) {
  const value = useMemo(() => ({ shikiTheme, revision }), [shikiTheme, revision])
  return (
    <ShikiThemeContext.Provider value={value}>
      {children}
    </ShikiThemeContext.Provider>
  )
}

/**
 * useShikiTheme - Access the current Shiki theme in components
 *
 * Returns null if no provider is present, allowing CodeBlock to fall back to
 * DOM-based detection for backwards compatibility.
 */
const listeners = new Set<() => void>()
let observer: MutationObserver | undefined
const readDOM = () => typeof document === 'undefined' ? 'github-light|default'
  : `${document.documentElement.classList.contains('dark') ? 'github-dark' : 'github-light'}|${document.documentElement.dataset.themeRevision ?? 'default'}`
function subscribeDOM(listener: () => void) {
  listeners.add(listener)
  if (!observer) {
    observer = new MutationObserver(() => listeners.forEach(callback => callback()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme-revision'] })
  }
  return () => { listeners.delete(listener); if (!listeners.size) { observer?.disconnect(); observer = undefined } }
}
const noSubscription = () => () => {}
export function useShikiThemeState() {
  const context = useContext(ShikiThemeContext)
  const dom = useSyncExternalStore(context.shikiTheme ? noSubscription : subscribeDOM, readDOM, () => 'github-light|default')
  const [theme, revision] = dom.split('|')
  return { shikiTheme: context.shikiTheme ?? theme!, revision: context.revision ?? revision!, hasProvider: context.shikiTheme !== null }
}
/** Reactive DOM fallback also updates memoized standalone Markdown consumers. */
export function useShikiTheme(): string {
  return useShikiThemeState().shikiTheme
}

export default ShikiThemeContext
