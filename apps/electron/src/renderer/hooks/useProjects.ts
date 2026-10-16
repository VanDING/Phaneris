/**
 * useProjects
 *
 * Loads workspace-scoped projects and keeps them in sync via the
 * `projects:changed` broadcast. Mirrors the lightweight half of `useAutomations`.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSetAtom } from 'jotai'
import { projectsAtom } from '@/atoms/projects'
import type { LoadedProject } from '@phaneris/shared/projects/types'

export interface UseProjectsResult {
  projects: LoadedProject[]
  refresh: () => Promise<void>
}

export function useProjects(activeWorkspaceId: string | null | undefined): UseProjectsResult {
  const [projects, setProjects] = useState<LoadedProject[]>([])
  const setProjectsAtom = useSetAtom(projectsAtom)
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    if (!activeWorkspaceId) {
      setProjects([])
      setProjectsAtom([])
      return
    }
    try {
      const result = await window.electronAPI.getProjects(activeWorkspaceId)
      if (version !== requestVersion.current) return
      const list = Array.isArray(result) ? (result as LoadedProject[]) : []
      setProjects(list)
      setProjectsAtom(list)
    } catch (err) {
      if (version !== requestVersion.current) return
      console.error('[useProjects] Failed to load projects:', err)
      setProjects([])
      setProjectsAtom([])
    }
  }, [activeWorkspaceId, setProjectsAtom])

  useEffect(() => {
    void refresh()
    return () => { requestVersion.current += 1 }
  }, [refresh])

  useEffect(() => {
    if (!activeWorkspaceId) return
    const off = window.electronAPI.onProjectsChanged((wsId: string, list: unknown) => {
      if (wsId !== activeWorkspaceId) return
      requestVersion.current++
      const projects = Array.isArray(list) ? (list as LoadedProject[]) : []
      setProjects(projects)
      setProjectsAtom(projects)
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [activeWorkspaceId, setProjectsAtom])

  return { projects, refresh }
}
