/** Standalone chrome uses the same compiler; its canvas is deliberately opaque. */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_THEME_FILE, getShikiTheme, resolveThemeMode, type ThemeFile } from '@phaneris/shared/config/theme'
import { ThemeCompilationError, type CompiledTheme, type HostThemeInput, type ResolvedThemeSnapshot } from '@phaneris/shared/config/theme-runtime'
import type { ThemeDiagnostic } from '@phaneris/shared/config/theme-manifest'
import { compileThemeInBrowser } from '../lib/theme-compiler'
import { ShikiThemeProvider } from './ShikiThemeContext'

const HostThemeContext = createContext<ResolvedThemeSnapshot | null>(null)
interface Applied { input: HostThemeInput; theme: ThemeFile; compiled: CompiledTheme; appliedId: string; status: 'ready' | 'error'; diagnostics: readonly ThemeDiagnostic[] }
export function HostThemeProvider({ input, children, onApplied }: { input: HostThemeInput | null; children: ReactNode; onApplied?: (snapshot: ResolvedThemeSnapshot) => void }) {
  const [applied, setApplied] = useState<Applied | null>(null)
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)'), changed = () => setSystemDark(media.matches)
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!input) return
    const controller = new AbortController(); setLoading(true)
    void (async () => {
      let theme = input.preset?.theme ?? DEFAULT_THEME_FILE, appliedId = input.preset?.id ?? input.requestedId, status: 'ready' | 'error' = 'ready'
      let diagnostics: readonly ThemeDiagnostic[] = input.preset?.diagnostics ?? [], compiled: CompiledTheme
      try {
        if (!input.preset) throw new ThemeCompilationError([{ path: 'theme', code: 'load', severity: 'error', message: 'Selected theme is missing' }])
        if (diagnostics.some(item => item.severity === 'error')) throw new ThemeCompilationError(diagnostics)
        compiled = await compileThemeInBrowser(theme, controller.signal, input.preset.revision)
        diagnostics = [...diagnostics, ...compiled.diagnostics]
      } catch (error) {
        if (controller.signal.aborted) return
        diagnostics = error instanceof ThemeCompilationError ? error.diagnostics : [{ path: 'theme', code: 'load', severity: 'error', message: String(error) }]
        theme = DEFAULT_THEME_FILE; appliedId = 'default'; status = 'error'
        compiled = await compileThemeInBrowser(theme, controller.signal)
      }
      if (!controller.signal.aborted) { setApplied({ input, theme, compiled, appliedId, status, diagnostics }); setLoading(false) }
    })().catch(error => { if (!controller.signal.aborted) console.error('Standalone theme fallback failed', error) })
    return () => controller.abort()
  }, [input])
  const snapshot = useMemo<ResolvedThemeSnapshot | null>(() => {
    if (!applied) return null
    const requestedMode = applied.input.preferences.mode, mode = resolveThemeMode(applied.theme, requestedMode === 'system' ? systemDark ? 'dark' : 'light' : requestedMode)
    return Object.freeze({ version: 1, requestedId: input?.requestedId ?? applied.input.requestedId, appliedId: applied.appliedId,
      source: applied.status === 'error' ? 'fallback' : 'ipc', requestedMode, actualMode: mode, status: loading ? 'loading' : applied.status,
      revision: `${applied.compiled.revision}:${mode}`, tokens: applied.compiled.tokens[mode],
      diagnostics: Object.freeze(applied.diagnostics.map(value => Object.freeze({ ...value }))), shiki: getShikiTheme(applied.theme.shikiTheme, mode === 'dark') })
  }, [applied, input?.requestedId, loading, systemDark])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.themeStatus = snapshot?.status ?? 'loading'
    root.dataset.themeHostPolicy = 'opaque-chrome'
    if (!snapshot || !applied) return
    root.classList.toggle('dark', snapshot.actualMode === 'dark'); root.classList.toggle('light', snapshot.actualMode === 'light')
    root.dataset.theme = snapshot.appliedId; root.dataset.themeRevision = snapshot.revision
    root.dataset.themeDepth = applied.theme.depth ?? 'elevated'; root.dataset.themeDensity = applied.theme.density ?? 'comfortable'
    const font = applied.input.preferences.font
    if (font === 'theme') delete root.dataset.font; else root.dataset.font = font
    delete root.dataset.scenic; root.style.removeProperty('--background-image')
    let style = document.getElementById('craft-host-theme') as HTMLStyleElement | null
    if (!style) { style = document.createElement('style'); style.id = 'craft-host-theme'; document.head.append(style) }
    style.textContent = `:root { ${applied.compiled.css[snapshot.actualMode]} }`
    window.dispatchEvent(new CustomEvent('craft-theme-change', { detail: { ...snapshot, id: snapshot.appliedId, mode: snapshot.actualMode } }))
    if (snapshot.status !== 'loading') onApplied?.(snapshot)
  }, [applied, onApplied, snapshot])
  return <HostThemeContext.Provider value={snapshot}><ShikiThemeProvider shikiTheme={snapshot?.shiki ?? null} revision={snapshot?.revision}>{children}</ShikiThemeProvider></HostThemeContext.Provider>
}
export const useHostTheme = () => useContext(HostThemeContext)
