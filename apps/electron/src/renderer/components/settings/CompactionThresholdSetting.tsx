import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsInput } from './SettingsInput'
import { Button } from '@/components/ui/button'

/** Blank retains the SDK default; changes apply at the next request. */
export function CompactionThresholdSetting({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'invalid' | 'load' | 'save' | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const pending = useRef(false)
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => window.electronAPI.getCompactionThreshold()).then(value => {
      if (cancelled) return
      setSaved(value); setDraft(value === null ? '' : String(value)); setLoaded(true)
    }).catch(() => { if (!cancelled) setError('load') })
    return () => { cancelled = true }
  }, [loadAttempt])
  const commit = async () => {
    if (!loaded || pending.current || disabled) return
    const text = draft.trim(), value = text ? Number(text) : null
    if (value !== null && (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 4096)) { setError('invalid'); return }
    if (value === saved) { setError(null); return }
    pending.current = true; setSaving(true); setError(null)
    try {
      await window.electronAPI.setCompactionThreshold(value)
      setSaved(value); setDraft(value === null ? '' : String(value))
    } catch { setError('save') }
    finally { pending.current = false; setSaving(false) }
  }
  return <SettingsInput inCard id="compaction-threshold-input" label={t('settings.ai.context.threshold')}
    description={t('settings.ai.context.thresholdDesc')} value={draft}
    onChange={value => { setDraft(value); setError(null) }} onBlur={() => void commit()}
    onKeyDown={event => { if (event.key === 'Enter' && event.currentTarget instanceof HTMLElement) event.currentTarget.blur() }}
    placeholder={t('settings.ai.context.thresholdDefault')} disabled={disabled || !loaded || saving}
    action={error === 'load' ? <Button variant="ghost" size="sm" onClick={() => { setError(null); setLoadAttempt(value => value + 1) }}>{t('common.retry')}</Button> : undefined}
    error={error === 'invalid' ? t('settings.ai.context.thresholdInvalid') : error === 'load' ? t('settings.ai.context.thresholdLoadFailed') : error === 'save' ? t('settings.ai.context.thresholdSaveFailed') : undefined} />
}
