import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CompactionThreshold } from '@phaneris/shared/agent/compaction-threshold'
import { SettingsMenuSelectRow } from './SettingsMenuSelect'
import { Button } from '@/components/ui/button'

/** Percentages follow the active model; legacy token limits remain readable. */
export function CompactionThresholdSetting({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<CompactionThreshold>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'load' | 'save' | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const pending = useRef(false)
  useEffect(() => {
    let cancelled = false
    window.electronAPI.getCompactionThreshold().then(value => {
      if (!cancelled) { setSaved(value); setLoaded(true) }
    }).catch(() => { if (!cancelled) setError('load') })
    return () => { cancelled = true }
  }, [loadAttempt])
  const value = saved === null ? 'default' : typeof saved === 'number' ? 'legacy' : String(saved.percent)
  const percentages = [50, 60, 70, 75, 80, 85, 90, 95]
  if (saved && typeof saved !== 'number' && !percentages.includes(saved.percent)) percentages.push(saved.percent)
  const commit = async (selection: string) => {
    if (!loaded || pending.current || disabled || selection === 'legacy') return
    const threshold = selection === 'default' ? null : { percent: Number(selection) }
    pending.current = true; setSaving(true); setError(null)
    await window.electronAPI.setCompactionThreshold(threshold).then(() => setSaved(threshold))
      .catch(() => setError('save'))
    pending.current = false; setSaving(false)
  }
  return <>
    <SettingsMenuSelectRow id="compaction-threshold-select" label={t('settings.ai.context.threshold')}
      description={t('settings.ai.context.thresholdDesc')} value={value}
      onValueChange={selection => void commit(selection)} disabled={disabled || !loaded || saving}
      options={[
        { value: 'default', label: t('settings.ai.context.thresholdDefault') },
        ...percentages.sort((a, b) => a - b).map(percent => ({ value: String(percent), label: `${percent}%` })),
        ...(typeof saved === 'number' ? [{ value: 'legacy', label: t('settings.ai.context.thresholdLegacy', { tokens: saved }) }] : []),
      ]} />
    {error && <div role="alert" className="px-4 pb-4 text-meta text-destructive">
      {t(error === 'load' ? 'settings.ai.context.thresholdLoadFailed' : 'settings.ai.context.thresholdSaveFailed')}
      {error === 'load' && <Button variant="ghost" size="sm" onClick={() => { setError(null); setLoadAttempt(attempt => attempt + 1) }}>{t('common.retry')}</Button>}
    </div>}
  </>
}
