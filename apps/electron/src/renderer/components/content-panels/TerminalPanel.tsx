import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
// Must follow xterm.css: it hardcodes a black `.xterm-viewport`, which is the
// backdrop you see when the terminal theme background is transparent.
import './terminal-overrides.css'
import { useAppShellContext } from '@/context/AppShellContext'

/**
 * Resolve a CSS custom property to a concrete colour.
 *
 * The theme engine emits complete colour values (`--foreground: #2A2B30`), so the
 * value is returned as-is. The previous version wrapped anything without a `(`
 * in `hsl(...)`, which turned every hex token into `hsl(#2A2B30)` — invalid CSS
 * that xterm silently discards, leaving the terminal on xterm's own defaults in
 * every theme. Bare HSL triplets (`240 10% 3.9%`) are still supported because
 * that spelling is common in CSS-variable palettes.
 */
function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!value) return fallback
  return /^[\d.]+(?:\s+[\d.]+%?){2}$/.test(value) ? `hsl(${value})` : value
}

/**
 * ANSI palettes.
 *
 * These cannot be a single set: on a light backdrop the dark-tuned `white` and
 * `brightWhite` are near-invisible, and on a dark backdrop the light-tuned ones
 * wash out. The app renders both modes, so the palette follows the same
 * `dark` class the rest of the theme switches on.
 */
const ANSI_DARK = {
  black: '#4b5563', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
  blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#e5e7eb',
  brightBlack: '#6b7280', brightRed: '#f87171', brightGreen: '#4ade80', brightYellow: '#facc15',
  brightBlue: '#60a5fa', brightMagenta: '#c084fc', brightCyan: '#22d3ee', brightWhite: '#f9fafb',
} as const

const ANSI_LIGHT = {
  black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
  blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#a0a1a7',
  brightBlack: '#696c77', brightRed: '#e45649', brightGreen: '#50a14f', brightYellow: '#c18401',
  brightBlue: '#4078f2', brightMagenta: '#a626a4', brightCyan: '#0184bc', brightWhite: '#383a42',
} as const

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

function terminalTheme() {
  return {
    // Transparent so the panel's own background shows through; the black
    // backdrop that used to defeat this came from xterm's stylesheet and is
    // neutralised in ./terminal-overrides.css.
    background: '#00000000',
    foreground: cssColor('--foreground', isDarkTheme() ? '#dfe1e7' : '#2a2b30'),
    cursor: cssColor('--foreground', isDarkTheme() ? '#dfe1e7' : '#2a2b30'),
    selectionBackground: cssColor('--accent', '#355b85'),
    ...(isDarkTheme() ? ANSI_DARK : ANSI_LIGHT),
  }
}

export function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { activeWorkspaceId, activeSessionWorkingDirectory, workspaces } = useAppShellContext()
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId)
  const workspaceRootPath = workspace?.rootPath
  const remoteServer = workspace?.remoteServer
  // The session directory is only the initial cwd for a workspace's shell.
  const initialCwdRef = useRef(activeSessionWorkingDirectory)
  initialCwdRef.current = activeSessionWorkingDirectory

  useEffect(() => {
    if (!hostRef.current || !workspaceRootPath || !activeWorkspaceId || remoteServer) return
    setError(null)
    let terminalId: string | null = null
    const terminal = new Terminal({ allowTransparency: true, convertEol: true, cursorBlink: true, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, scrollback: 5000, theme: terminalTheme() })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(hostRef.current)
    fit.fit()
    let disposed = false
    const cwd = initialCwdRef.current || workspaceRootPath
    void window.electronAPI.createTerminal({ workspaceId: activeWorkspaceId, cwd, cols: terminal.cols, rows: terminal.rows })
      .then(async (info) => {
        if (disposed) return
        terminalId = info.running ? info.id : null
        if (info.output) terminal.write(info.output)
        if (!info.running) terminal.writeln(`\r\n[process exited ${info.exitCode ?? ''}]`)
        terminal.focus()
        if (info.running) await window.electronAPI.resizeTerminal(info.id, terminal.cols, terminal.rows)
      }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) })
    const offData = window.electronAPI.onTerminalData(({ id, data }) => { if (id === terminalId) terminal.write(data) })
    const offExit = window.electronAPI.onTerminalExit(({ id, exitCode }) => { if (id === terminalId) terminal.writeln(`\r\n[process exited ${exitCode}]`) })
    const input = terminal.onData((data) => { const id = terminalId; if (id) void window.electronAPI.writeTerminal(id, data) })
    const resize = new ResizeObserver(() => { fit.fit(); const id = terminalId; if (id) void window.electronAPI.resizeTerminal(id, terminal.cols, terminal.rows) })
    resize.observe(hostRef.current)
    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => { disposed = true; offData(); offExit(); input.dispose(); resize.disconnect(); themeObserver.disconnect(); terminal.dispose() }
  }, [activeWorkspaceId, workspaceRootPath, remoteServer])

  if (remoteServer) return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The integrated terminal is available for local workspaces only.</div>
  return (
    <div className="flex h-full min-h-0 flex-col bg-background/40 p-2">
      {error && <div className="p-4 text-sm text-destructive">{error}</div>}
      <div ref={hostRef} className="min-h-0 w-full flex-1 overflow-hidden" />
    </div>
  )
}
