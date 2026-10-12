/** Pure snapshot contract; DOM compilation is owned by @phaneris/ui. */
import type { ThemeDiagnostic } from './theme-manifest'
import type { PresetTheme, ThemePreferences } from './theme'

/** Authoritative input for trusted standalone chrome, ordered per native window. */
export interface HostThemeInput {
  readonly sequence: number
  readonly requestedId: string
  readonly preferences: ThemePreferences
  readonly preset: PresetTheme | null
}

type VisualMode = 'light' | 'dark'
export interface CompiledTheme {
  readonly revision: string
  readonly css: Readonly<Record<VisualMode, string>>
  readonly tokens: Readonly<Record<VisualMode, Readonly<Record<string, string>>>>
  readonly diagnostics: readonly ThemeDiagnostic[]
}
export interface ResolvedThemeSnapshot {
  readonly version: 1
  readonly requestedId: string
  readonly appliedId: string
  readonly source: 'builtin' | 'ipc' | 'fallback'
  readonly requestedMode: 'light' | 'dark' | 'system'
  readonly actualMode: VisualMode
  readonly status: 'loading' | 'ready' | 'error'
  readonly revision: string
  readonly diagnostics: readonly ThemeDiagnostic[]
  readonly tokens: Readonly<Record<string, string>>
  readonly shiki: string
}
export class ThemeCompilationError extends Error {
  constructor(readonly diagnostics: readonly ThemeDiagnostic[]) {
    super(diagnostics.map(value => `${value.path}: ${value.message}`).join('; '))
    this.name = 'ThemeCompilationError'
  }
}
export function themeCSSDeclarations(css: string): Record<string, string> {
  return Object.fromEntries([...css.matchAll(/(--[\w\\.-]+)\s*:\s*([^;]+);/g)].map(match => [match[1]!.replaceAll('\\.', '.'), match[2]!.trim()]))
}
