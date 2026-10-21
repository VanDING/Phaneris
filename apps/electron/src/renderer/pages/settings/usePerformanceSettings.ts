/**
 * Performance settings (prompt cache, cache warming, context policy), extracted
 * from AiSettingsPage.
 *
 * Seven `useState` hooks and three optimistic-write handlers that only ever
 * concern this one settings card. Each toggle applies the new value immediately,
 * rolls back and toasts on failure — behaviour moved verbatim, not re-derived.
 *
 * The hook returns the page's original names so the JSX stays byte-identical.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ContextPolicy } from '@phaneris/shared/agent/context-policy'

export interface PerformanceSettings {
  extendedPromptCache: boolean
  savingExtendedCache: boolean
  performanceOpen: boolean
  setPerformanceOpen: (open: boolean) => void
  promptCacheWarming: boolean
  savingCacheWarming: boolean
  contextPolicy: ContextPolicy
  savingContextPolicy: boolean
  handleExtendedPromptCacheChange: (enabled: boolean) => Promise<void>
  handlePromptCacheWarmingChange: (enabled: boolean) => Promise<void>
  handleContextPolicyChange: (next: ContextPolicy) => Promise<void>
}

export function usePerformanceSettings(workspaceId: string | null | undefined): PerformanceSettings {
  const { t } = useTranslation()
  const [extendedPromptCache, setExtendedPromptCache] = useState(false)
  const [savingExtendedCache, setSavingExtendedCache] = useState(false)
  const [performanceOpen, setPerformanceOpen] = useState(false)
  const [promptCacheWarming, setPromptCacheWarming] = useState(false)
  const [savingCacheWarming, setSavingCacheWarming] = useState(false)
  const [contextPolicy, setContextPolicy] = useState<ContextPolicy>('compact')
  const [savingContextPolicy, setSavingContextPolicy] = useState(false)

  // Read on workspace switch: these live in the workspace's preferences file.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const extendedCache = await window.electronAPI.getExtendedPromptCache()
        if (cancelled) return
        setExtendedPromptCache(extendedCache)
        setPromptCacheWarming(await window.electronAPI.getPromptCacheWarming())
        setContextPolicy(await window.electronAPI.getContextPolicy())
      } catch (error) {
        console.error('Failed to load performance settings:', error)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [workspaceId])

  const handleExtendedPromptCacheChange = useCallback(async (enabled: boolean) => {
    const previous = extendedPromptCache
    setSavingExtendedCache(true); setExtendedPromptCache(enabled)
    try { await window.electronAPI.setExtendedPromptCache(enabled) }
    catch { setExtendedPromptCache(previous); toast.error(t('toast.failedToSaveSetting', { setting: t('settings.ai.extendedPromptCache') })) }
    finally { setSavingExtendedCache(false) }
  }, [extendedPromptCache, t])

  const handlePromptCacheWarmingChange = useCallback(async (enabled: boolean) => {
    setSavingCacheWarming(true)
    try {
      await window.electronAPI.setPromptCacheWarming(enabled)
      setPromptCacheWarming(enabled)
    } catch {
      toast.error(t('toast.failedToSaveSetting', { setting: t('settings.ai.promptCacheWarming') }))
    } finally {
      setSavingCacheWarming(false)
    }
  }, [t])

  const handleContextPolicyChange = useCallback(async (next: ContextPolicy) => {
    const previous = contextPolicy
    if (next === previous) return
    setSavingContextPolicy(true)
    // Optimistic switch: the two strategies are mutually exclusive by
    // construction, so the UI must never show both as on.
    setContextPolicy(next)
    try {
      await window.electronAPI.setContextPolicy(next)
    } catch {
      setContextPolicy(previous)
      toast.error(t('toast.failedToSaveSetting', { setting: t('settings.ai.context.title') }))
    } finally {
      setSavingContextPolicy(false)
    }
  }, [contextPolicy, t])

  return {
    extendedPromptCache,
    savingExtendedCache,
    performanceOpen,
    setPerformanceOpen,
    promptCacheWarming,
    savingCacheWarming,
    contextPolicy,
    savingContextPolicy,
    handleExtendedPromptCacheChange,
    handlePromptCacheWarmingChange,
    handleContextPolicyChange,
  }
}
