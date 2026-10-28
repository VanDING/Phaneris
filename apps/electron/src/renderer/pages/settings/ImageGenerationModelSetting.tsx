import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsInput, SettingsMenuSelectRow } from '@/components/settings'
import type { ImageGenerationSettings, ImageGenerationStatus } from '../../../shared/types'

/** Native image catalogs and arbitrary Images API model IDs have different editors. */
export function ImageGenerationModelSetting({ connection, settings, disabled, onSave, effectiveModel }: {
  connection?: ImageGenerationStatus['connections'][number]
  settings: ImageGenerationSettings
  disabled: boolean
  effectiveModel?: string
  onSave: (settings: ImageGenerationSettings) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(settings.model ?? '')
  useEffect(() => { setDraft(settings.model ?? '') }, [connection?.slug, settings.model])
  if (!connection) return null
  if (connection.provider === 'openai-compatible') return <SettingsInput inCard
    label={t('settings.ai.model')} description={t('settings.ai.images.compatibleHint')}
    value={draft} placeholder={t('settings.ai.images.compatibleModel')} disabled={disabled} onChange={setDraft}
    onBlur={() => { if (draft.trim() !== (settings.model ?? '')) void onSave({ ...settings, model: draft.trim() || undefined }) }} />
  return <SettingsMenuSelectRow label={t('settings.ai.model')} value={settings.model || 'provider-default'} disabled={disabled}
    onValueChange={model => void onSave({ ...settings, model: model === 'provider-default' ? undefined : model })}
    options={[{ value: 'provider-default', label: t('settings.ai.useConnectionDefault'), description: effectiveModel },
      ...(settings.model && !connection.models.some(model => model.id === settings.model)
        ? [{ value: settings.model, label: settings.model, description: t('settings.ai.unavailableModel') }] : []),
      ...connection.models.map(model => ({ value: model.id, label: model.name })),
    ]} />
}
