import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { HostThemeProvider } from '@phaneris/ui/context'
import type { HostThemeInput, ResolvedThemeSnapshot } from '@phaneris/shared/config/theme-runtime'

declare global { interface Window { __phanerisBrowserTheme?: HostThemeInput } }
/** Empty state has no privileged preload. Only main injects into its trusted URL. */
export function BrowserThemeHost({ children, toolbar = false }: { children: ReactNode; toolbar?: boolean }) {
  const [input, setInput] = useState<HostThemeInput | null>(() => window.__phanerisBrowserTheme ?? null)
  useEffect(() => {
    let disposed = false
    const accept = (next: HostThemeInput) => { if (!disposed) setInput(previous => !previous || next.sequence > previous.sequence ? next : previous) }
    const changed = (event: Event) => accept((event as CustomEvent<HostThemeInput>).detail)
    window.addEventListener('craft-browser-theme', changed)
    const api = toolbar ? window.browserToolbar : undefined
    const unsubscribe = api?.onHostTheme(accept)
    void api?.getHostTheme().then(accept).catch(() => {})
    // The native did-finish-load may precede this passive effect.
    if (window.__phanerisBrowserTheme) accept(window.__phanerisBrowserTheme)
    return () => { disposed = true; unsubscribe?.(); window.removeEventListener('craft-browser-theme', changed) }
  }, [toolbar])
  const report = useCallback((snapshot: ResolvedThemeSnapshot) => {
    if (!toolbar || !input) return
    const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.append(probe)
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
    canvas.width = canvas.height = 1; context.fillStyle = getComputedStyle(probe).color; context.fillRect(0, 0, 1, 1)
    const accent = '#' + Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join(''); probe.remove()
    const channels = accent.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    const luminance = channels.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0)
    const onAccent = (luminance + .05) / .05 > 1.05 / (luminance + .05) ? '#000000' : '#ffffff'
    void window.browserToolbar?.reportHostTheme({ sequence: input.sequence, revision: snapshot.revision, accent, onAccent }).catch(() => {})
  }, [input, toolbar])
  return <HostThemeProvider input={input} onApplied={report}>{children}</HostThemeProvider>
}
