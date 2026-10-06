/**
 * useDiffViewerSettings - Diff viewer display preferences.
 *
 * Loaded from ~/.phaneris/preferences.json (diffViewer scope) and persisted
 * on change. Extracted from ChatDisplay's inline logic so the Review panel
 * shares the exact same settings source (the plan reuses the same stats/UI).
 *
 * The persisted read is asynchronous while the toggle is immediately
 * interactive, so a late read must never clobber a choice the user already
 * made. `update` flips `userChosenRef`; the initial read only applies when
 * that flag is still false.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DiffViewerSettings } from '@phaneris/ui'

export interface ResolvedDiffViewerSettings {
  diffStyle: 'unified' | 'split'
  disableBackground: boolean
}

export function useDiffViewerSettings(): [
  ResolvedDiffViewerSettings,
  (settings: DiffViewerSettings) => void,
] {
  const [settings, setSettings] = useState<Partial<DiffViewerSettings>>({})
  const userChosenRef = useRef(false)

  useEffect(() => {
    let stale = false
    window.electronAPI.readPreferences().then(({ content }) => {
      if (stale) return
      try {
        const prefs = JSON.parse(content)
        if (!prefs.diffViewer) return
        // The user toggled before the read resolved: keep their selection.
        if (userChosenRef.current) return
        setSettings(prefs.diffViewer)
      } catch {
        // Ignore parse errors, use defaults
      }
    })
    return () => { stale = true }
  }, [])

  const update = useCallback((next: DiffViewerSettings) => {
    userChosenRef.current = true
    setSettings(next)
    window.electronAPI.readPreferences().then(({ content }) => {
      try {
        const prefs = JSON.parse(content)
        prefs.diffViewer = next
        prefs.updatedAt = Date.now()
        window.electronAPI.writePreferences(JSON.stringify(prefs, null, 2))
      } catch {
        // Malformed preferences — write a fresh scope
        window.electronAPI.writePreferences(JSON.stringify({ diffViewer: next, updatedAt: Date.now() }, null, 2))
      }
    })
  }, [])

  return [
    {
      diffStyle: settings.diffStyle ?? 'unified',
      disableBackground: settings.disableBackground ?? false,
    },
    update,
  ]
}
