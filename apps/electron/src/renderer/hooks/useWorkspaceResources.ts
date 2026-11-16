/**
 * Workspace resources: sources, skills, plugins.
 *
 * These three used to live inline in AppShell as three `useState` pairs, three
 * atom-sync effects and three fetch effects — roughly 100 lines in a file that is
 * already the largest in the renderer, and all of it the same shape:
 *
 *   fetch → store → mirror into an atom for NavigationContext → subscribe to
 *   patch events → clear on workspace switch.
 *
 * The only part that is not mechanical is `loaded`: an empty array means two
 * different things (this workspace has none, or the request has not answered
 * yet), and the list panels must not render "no skills configured" for the
 * second. Each resource therefore reports `{ items, loaded }` rather than a bare
 * array, so the distinction cannot be lost at the call site.
 *
 * `readAfterReconnect` wraps the fetch because a request issued while the
 * transport is reconnecting would otherwise reject and be reported as "empty".
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { pluginsAtom, pluginLoadErrorsAtom } from '@/atoms/plugins'
import { readAfterReconnect } from '@/lib/read-after-reconnect'
import { clearSourceIconCaches } from '@/lib/icon-cache'
import type { LoadedSkill, LoadedSource, PluginLoadError, PluginSummary, PluginsListResult } from '../../shared/types'

export interface LoadedResource<T> {
  items: T[]
  /** The first request has answered (successfully or not). */
  loaded: boolean
}

interface WorkspaceResources {
  sources: LoadedResource<LoadedSource>
  skills: LoadedResource<LoadedSkill>
  plugins: LoadedResource<PluginSummary>
  pluginLoadErrors: PluginLoadError[]
  reloadPlugins: (workspaceId: string) => Promise<void>
}

export function useWorkspaceResources(
  activeWorkspaceId: string | null | undefined,
  workingDirectory: string | undefined,
): WorkspaceResources {
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  const [sourcesLoaded, setSourcesLoaded] = React.useState(false)
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  const [skillsLoaded, setSkillsLoaded] = React.useState(false)
  const [plugins, setPlugins] = React.useState<PluginSummary[]>([])
  const [pluginLoadErrors, setPluginLoadErrors] = React.useState<PluginLoadError[]>([])

  const setSourcesAtom = useSetAtom(sourcesAtom)
  const setSkillsAtom = useSetAtom(skillsAtom)
  const setPluginsAtom = useSetAtom(pluginsAtom)
  const setPluginLoadErrorsAtom = useSetAtom(pluginLoadErrorsAtom)

  // Mirror into atoms so NavigationContext can auto-select without prop drilling.
  React.useEffect(() => { setSourcesAtom(sources) }, [sources, setSourcesAtom])
  React.useEffect(() => { setSkillsAtom(skills) }, [skills, setSkillsAtom])
  React.useEffect(() => { setPluginsAtom(plugins) }, [plugins, setPluginsAtom])
  React.useEffect(() => { setPluginLoadErrorsAtom(pluginLoadErrors) }, [pluginLoadErrors, setPluginLoadErrorsAtom])

  React.useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    setSourcesLoaded(false)
    readAfterReconnect(() => window.electronAPI.getSources(activeWorkspaceId)).then((loaded) => {
      if (cancelled) return
      setSources(loaded || [])
      setSourcesLoaded(true)
    }).catch((err) => {
      if (cancelled) return
      // The request answered (with a failure): the list is genuinely empty, not pending.
      setSourcesLoaded(true)
      console.error('[Chat] Failed to load sources:', err)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId])

  React.useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    setSkillsLoaded(false)
    readAfterReconnect(() => window.electronAPI.getSkills(activeWorkspaceId, workingDirectory)).then((loaded) => {
      if (cancelled) return
      setSkills(loaded || [])
      setSkillsLoaded(true)
    }).catch((err) => {
      if (cancelled) return
      setSkillsLoaded(true)
      console.error('[Chat] Failed to load skills:', err)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, workingDirectory])

  // Live updates: sources/skills can be added or removed while the app is open.
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId, updatedSources) => {
      if (workspaceId !== activeWorkspaceId) return
      // Icons are cached by source id and would keep the stale glyph otherwise.
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged((workspaceId, updatedSkills) => {
      if (workspaceId !== activeWorkspaceId) return
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  const reloadPlugins = React.useCallback(async (workspaceId: string) => {
    try {
      const result = await window.electronAPI.getPlugins(workspaceId)
      setPlugins(result?.plugins ?? [])
      setPluginLoadErrors(result?.errors ?? [])
    } catch (err) {
      console.error('[Plugins] Failed to load plugins:', err)
      setPlugins([])
      setPluginLoadErrors([])
    }
  }, [])

  React.useEffect(() => {
    if (!activeWorkspaceId) {
      setPlugins([])
      setPluginLoadErrors([])
      return
    }
    void reloadPlugins(activeWorkspaceId)
  }, [activeWorkspaceId, reloadPlugins])

  // A bundle can change without the plugin list being replaced wholesale: edits
  // and reinstalls happen on disk. `plugins:changed` also carries the payload.
  React.useEffect(() => {
    const cleanup = window.electronAPI.onPluginsChanged((workspaceId: string, payload: PluginsListResult) => {
      if (workspaceId !== activeWorkspaceId) return
      setPlugins(payload?.plugins ?? [])
      setPluginLoadErrors(payload?.errors ?? [])
    })
    return cleanup
  }, [activeWorkspaceId])

  return {
    sources: { items: sources, loaded: sourcesLoaded },
    skills: { items: skills, loaded: skillsLoaded },
    // Plugins have no separate loaded flag: an empty list is a legitimate
    // "nothing installed", and a bundle that fails to load still appears.
    plugins: { items: plugins, loaded: true },
    pluginLoadErrors,
    reloadPlugins,
  }
}

