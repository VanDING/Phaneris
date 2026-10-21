/**
 * Decision-layer (Jev / TypeSafe "System One") settings, extracted from
 * AiSettingsPage.
 *
 * The page had grown to ~1,470 lines with 38 `useState` hooks in one component.
 * This domain owns eleven of them plus a seeded-drafts ref, three effects and
 * eight handlers: load status, seed the key/model/base-URL drafts once, save a
 * patch, save/remove the API key, test the connection, and probe a local server.
 *
 * The hook returns the page's original names so the JSX and the derived view
 * data (feature groups, key-source options, probe description) stay where they
 * are — those are pure projections of `decisionStatus`, not state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { DECISION_SETTINGS_CHANGED_EVENT, guardedModeAvailableAtom } from '@/atoms/permission-modes'
import { AI_SETTINGS_FOCUS_EVENT, AI_SETTINGS_FOCUS_KEY } from '@/lib/ai-settings-navigation'
import type {
  DecisionLayerSettingsPatch,
  DecisionLayerStatus,
  DecisionProviderId,
  DecisionServerProbe,
  DecisionTestResult,
} from '../../../shared/types'

export interface DecisionLayerSettings {
  decisionConfigurationOpen: boolean
  setDecisionConfigurationOpen: (open: boolean) => void
  decisionLoadError: string | null
  savingDecisions: boolean
  decisionStatus: DecisionLayerStatus | null
  decisionKeyDraft: string
  setDecisionKeyDraft: (value: string) => void
  decisionModelDraft: string
  setDecisionModelDraft: (value: string) => void
  decisionBaseUrlDraft: string
  setDecisionBaseUrlDraft: (value: string) => void
  decisionTesting: boolean
  decisionTestResult: DecisionTestResult | null
  decisionProbe: DecisionServerProbe | null
  decisionProbing: boolean
  refreshDecisionStatus: (seedDrafts: boolean) => Promise<void>
  updateDecisionSettings: (patch: DecisionLayerSettingsPatch) => Promise<void>
  probeDecisionServer: (baseUrl?: string) => Promise<void>
  /** Drop the cached probe result (called when the selected provider stops being local). */
  clearDecisionProbe: () => void
  handleDecisionKeySourceChange: (value: string) => void
  commitDecisionField: (field: 'model' | 'baseUrl', value: string) => void
  handleSaveDecisionKey: () => Promise<void>
  handleRemoveDecisionKey: () => Promise<void>
  handleTestDecision: () => Promise<void>
}

/**
 * `refreshToken` exists because the decision status carries the reusable
 * connection list: a background model fetch re-emits `llmConnections`, and the
 * status has to follow it. Only the first load seeds the drafts.
 */
export function useDecisionLayerSettings(refreshToken: unknown): DecisionLayerSettings {
  const { t } = useTranslation()
  const setGuardedAvailable = useSetAtom(guardedModeAvailableAtom)

  const [decisionConfigurationOpen, setDecisionConfigurationOpen] = useState(
    () => sessionStorage.getItem(AI_SETTINGS_FOCUS_KEY) === 'decisions',
  )
  const [decisionLoadError, setDecisionLoadError] = useState<string | null>(null)
  const [savingDecisions, setSavingDecisions] = useState(false)
  const [decisionStatus, setDecisionStatus] = useState<DecisionLayerStatus | null>(null)
  const [decisionKeyDraft, setDecisionKeyDraft] = useState('')
  const [decisionModelDraft, setDecisionModelDraft] = useState('')
  const [decisionBaseUrlDraft, setDecisionBaseUrlDraft] = useState('')
  const [decisionTesting, setDecisionTesting] = useState(false)
  const [decisionTestResult, setDecisionTestResult] = useState<DecisionTestResult | null>(null)
  const [decisionProbe, setDecisionProbe] = useState<DecisionServerProbe | null>(null)
  const [decisionProbing, setDecisionProbing] = useState(false)
  const decisionDraftsSeededRef = useRef(false)

  const refreshDecisionStatus = useCallback(async (seedDrafts: boolean) => {
    if (typeof window.electronAPI?.getDecisionLayerStatus !== 'function') return
    try {
      const status = await window.electronAPI.getDecisionLayerStatus()
      setDecisionStatus(status)
      setDecisionLoadError(null)
      setGuardedAvailable(status.guardedMode?.available === true)
      if (seedDrafts) {
        setDecisionModelDraft(status.settings.model ?? '')
        setDecisionBaseUrlDraft(status.settings.baseUrl ?? '')
        decisionDraftsSeededRef.current = true
      }
    } catch (error) {
      setGuardedAvailable(false)
      setDecisionLoadError(error instanceof Error ? error.message : String(error))
      setDecisionStatus(previous => previous ? { ...previous, guardedMode: { available: false, reason: 'unavailable' } } : previous)
      console.error('Failed to load decision model settings:', error)
    }
  }, [setGuardedAvailable])

  // Reusable connections come from the LLM connection list, so refresh with it
  // (background model fetches re-emit that list; only the first load seeds drafts).
  useEffect(() => {
    void refreshDecisionStatus(!decisionDraftsSeededRef.current)
  }, [refreshDecisionStatus, refreshToken])

  // Deep link: the menu asks for the decision card, then we scroll to it once the
  // status (or its error) has rendered.
  useEffect(() => {
    const focus = () => {
      if (sessionStorage.getItem(AI_SETTINGS_FOCUS_KEY) !== 'decisions') return
      setDecisionConfigurationOpen(true)
      if (decisionStatus || decisionLoadError) {
        sessionStorage.removeItem(AI_SETTINGS_FOCUS_KEY)
        requestAnimationFrame(() => document.querySelector('[data-decision-settings]')?.scrollIntoView({ block: 'start' }))
      }
    }
    focus()
    window.addEventListener(AI_SETTINGS_FOCUS_EVENT, focus)
    return () => window.removeEventListener(AI_SETTINGS_FOCUS_EVENT, focus)
  }, [decisionStatus, decisionLoadError])

  const updateDecisionSettings = useCallback(async (patch: DecisionLayerSettingsPatch) => {
    setSavingDecisions(true)
    try {
      const next = await window.electronAPI.setDecisionLayerSettings(patch)
      setDecisionStatus(prev => (prev ? { ...prev, settings: next } : prev))
      setDecisionTestResult(null)
      await refreshDecisionStatus(false)
      // Mode pickers offer Guarded mode only while it is on: let them refresh.
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
      // A provider/connection switch drops the model + base URL overrides server-side
      // (they belonged to the previous provider) — mirror that in the inputs.
      if ('provider' in patch || 'connectionSlug' in patch) {
        setDecisionModelDraft(next.model ?? '')
        setDecisionBaseUrlDraft(next.baseUrl ?? '')
      }
    } catch (error) {
      console.error('Failed to update decision model settings:', error)
      toast.error(t('settings.ai.decisions.saveFailed'))
    } finally { setSavingDecisions(false) }
  }, [t, refreshDecisionStatus])

  const probeDecisionServer = useCallback(async (baseUrl?: string) => {
    if (typeof window.electronAPI?.probeDecisionServer !== 'function') return
    setDecisionProbing(true)
    try {
      setDecisionProbe(await window.electronAPI.probeDecisionServer(baseUrl ? { baseUrl } : undefined))
    } catch (error) {
      console.error('Failed to probe decision server:', error)
      setDecisionProbe(null)
    } finally {
      setDecisionProbing(false)
    }
  }, [])

  const clearDecisionProbe = useCallback(() => setDecisionProbe(null), [])

  const handleDecisionKeySourceChange = useCallback((value: string) => {
    setDecisionKeyDraft('')
    if (value.startsWith('connection:')) {
      const slug = value.slice('connection:'.length)
      const provider = decisionStatus?.reusableConnections.find(c => c.slug === slug)?.provider
      void updateDecisionSettings({ connectionSlug: slug, ...(provider ? { provider } : {}) })
    } else if (value.startsWith('provider:')) {
      void updateDecisionSettings({ connectionSlug: null, provider: value.slice('provider:'.length) as DecisionProviderId })
    }
  }, [decisionStatus, updateDecisionSettings])

  const commitDecisionField = useCallback((field: 'model' | 'baseUrl', value: string) => {
    const current = decisionStatus?.settings[field] ?? ''
    if (value.trim() === current) return
    void updateDecisionSettings({ [field]: value.trim() || null })
  }, [decisionStatus, updateDecisionSettings])

  const handleSaveDecisionKey = useCallback(async () => {
    if (!decisionStatus || !decisionKeyDraft.trim()) return
    try {
      await window.electronAPI.setDecisionApiKey(decisionStatus.settings.provider, decisionKeyDraft.trim())
      setDecisionKeyDraft('')
      toast.success(t('settings.ai.decisions.keySaved'))
      await refreshDecisionStatus(false)
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
    } catch (error) {
      console.error('Failed to save decision model key:', error)
      toast.error(t('settings.ai.decisions.saveFailed'))
    }
  }, [decisionStatus, decisionKeyDraft, refreshDecisionStatus, t])

  const handleRemoveDecisionKey = useCallback(async () => {
    if (!decisionStatus) return
    try {
      await window.electronAPI.deleteDecisionApiKey(decisionStatus.settings.provider)
      toast.success(t('settings.ai.decisions.keyRemoved'))
      await refreshDecisionStatus(false)
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
    } catch (error) {
      console.error('Failed to remove decision model key:', error)
      toast.error(t('settings.ai.decisions.saveFailed'))
    }
  }, [decisionStatus, refreshDecisionStatus, t])

  const handleTestDecision = useCallback(async () => {
    setDecisionTesting(true)
    setDecisionTestResult(null)
    try {
      const result = await window.electronAPI.testDecisionConnection({
        settings: { model: decisionModelDraft.trim() || null, baseUrl: decisionBaseUrlDraft.trim() || null },
        apiKey: decisionKeyDraft.trim() || undefined,
      })
      setDecisionTestResult(result)
    } catch (error) {
      setDecisionTestResult({ ok: false, failure: { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) } })
    } finally {
      setDecisionTesting(false)
    }
  }, [decisionModelDraft, decisionBaseUrlDraft, decisionKeyDraft])

  return {
    decisionConfigurationOpen,
    setDecisionConfigurationOpen,
    decisionLoadError,
    savingDecisions,
    decisionStatus,
    decisionKeyDraft,
    setDecisionKeyDraft,
    decisionModelDraft,
    setDecisionModelDraft,
    decisionBaseUrlDraft,
    setDecisionBaseUrlDraft,
    decisionTesting,
    decisionTestResult,
    decisionProbe,
    decisionProbing,
    refreshDecisionStatus,
    updateDecisionSettings,
    probeDecisionServer,
    clearDecisionProbe,
    handleDecisionKeySourceChange,
    commitDecisionField,
    handleSaveDecisionKey,
    handleRemoveDecisionKey,
    handleTestDecision,
  }
}
