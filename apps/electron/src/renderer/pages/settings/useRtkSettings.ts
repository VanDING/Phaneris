/**
 * RTK (token-reduction toolkit) settings, extracted from AiSettingsPage.
 *
 * The page had grown to ~1,500 lines with 44 `useState` hooks in it; six of them
 * (plus two effects and four handlers) exist only to run the RTK row. Nothing here
 * touches the rest of the page: it owns the enabled flag, the install/version
 * status, the recheck and update-dialog state, and the gain statistics.
 *
 * The hook deliberately returns the page's original names so the JSX stays
 * byte-identical while the state and its writers move together.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { RtkStatusInfo } from '@/components/RtkUpdateDialog'

export interface RtkGain {
  totalCommands: number
  totalInput: number
  totalOutput: number
  totalSaved: number
  avgSavingsPct: number
}

export interface RtkSettings {
  rtkEnabled: boolean
  savingRtk: boolean
  rtkStatus: RtkStatusInfo | null
  setRtkStatus: (status: RtkStatusInfo | null) => void
  rtkRechecking: boolean
  rtkUpdateOpen: boolean
  setRtkUpdateOpen: (open: boolean) => void
  rtkGain: RtkGain | null
  refreshRtkGain: () => Promise<void>
  handleRtkToggle: (enabled: boolean) => Promise<void>
  handleRecheckRtk: () => Promise<void>
  handleGetRtk: () => void
}

export function useRtkSettings(workspaceId: string | null | undefined): RtkSettings {
  const { t } = useTranslation()
  const [rtkEnabled, setRtkEnabled] = useState(false)
  const [savingRtk, setSavingRtk] = useState(false)
  const [rtkStatus, setRtkStatus] = useState<RtkStatusInfo | null>(null)
  const [rtkRechecking, setRtkRechecking] = useState(false)
  const [rtkUpdateOpen, setRtkUpdateOpen] = useState(false)
  const [rtkGain, setRtkGain] = useState<RtkGain | null>(null)

  // RTK is workspace-independent, but it is read when the workspace switches so
  // the row never shows another workspace's install state.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const enabled = await window.electronAPI.getRtkEnabled()
        if (!cancelled) setRtkEnabled(enabled)
        const status = await window.electronAPI.getRtkStatus()
        if (!cancelled) setRtkStatus(status)
      } catch (error) {
        console.error('Failed to load RTK settings:', error)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [workspaceId])

  const handleRtkToggle = useCallback(async (enabled: boolean) => {
    const previous = rtkEnabled
    setSavingRtk(true); setRtkEnabled(enabled)
    try { await window.electronAPI.setRtkEnabled(enabled) }
    catch { setRtkEnabled(previous); toast.error(t('toast.failedToSaveSetting', { setting: t('settings.ai.rtk.title') })) }
    finally { setSavingRtk(false) }
  }, [rtkEnabled, t])

  const handleRecheckRtk = useCallback(async () => {
    setRtkRechecking(true)
    try {
      const status = await window.electronAPI?.getRtkStatus({ forceRecheck: true })
      if (status) setRtkStatus(status)
    } finally {
      setRtkRechecking(false)
    }
  }, [])

  const handleGetRtk = useCallback(() => {
    window.electronAPI?.openUrl('https://github.com/rtk-ai/rtk')
  }, [])

  const refreshRtkGain = useCallback(async () => {
    const gain = await window.electronAPI?.getRtkGain()
    setRtkGain((gain ?? null) as RtkGain | null)
  }, [])

  // Refresh gain stats whenever rtk transitions to installed-and-enabled
  useEffect(() => {
    if (rtkStatus?.path && !rtkStatus.outdated && rtkEnabled) {
      void refreshRtkGain()
    } else {
      setRtkGain(null)
    }
  }, [rtkStatus?.path, rtkStatus?.outdated, rtkEnabled, refreshRtkGain])

  return {
    rtkEnabled,
    savingRtk,
    rtkStatus,
    setRtkStatus,
    rtkRechecking,
    rtkUpdateOpen,
    setRtkUpdateOpen,
    rtkGain,
    refreshRtkGain,
    handleRtkToggle,
    handleRecheckRtk,
    handleGetRtk,
  }
}
