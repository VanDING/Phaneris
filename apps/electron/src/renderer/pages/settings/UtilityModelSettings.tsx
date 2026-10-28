import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMiniModel, isDeniedMiniModelId } from '@config/llm-connections'
import { getModelOptionsForConnection } from '@/lib/ai-model-options'
import { SettingsCard, SettingsMenuSelectRow, SettingsSection } from '@/components/settings'
import type { LlmConnectionWithStatus } from '../../../shared/types'

/** Utility calls stay on the session's connection, including its credentials. */
export function UtilityModelSettings({ connections, onSaved }: {
  connections: LlmConnectionWithStatus[]
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [selectedSlug, setSelectedSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const connection = connections.find(item => item.slug === selectedSlug)
    ?? connections.find(item => item.isDefault) ?? connections[0]
  const automaticModel = connection ? getMiniModel({ ...connection, utilityModel: undefined }) : undefined
  const options = getModelOptionsForConnection(connection)
    .filter(model => !isDeniedMiniModelId(model.value, connection?.piAuthProvider))

  const save = async (value: string) => {
    if (!connection || saving) return
    setSaving(true)
    setError(undefined)
    const result = await window.electronAPI.setupLlmConnection({
      slug: connection.slug,
      updateOnly: true,
      utilityModel: value === 'automatic' ? null : value,
    }).catch(() => ({ success: false }))
    if (result.success) await Promise.resolve(onSaved()).catch(() => setError(t('settings.ai.utility.saveFailed')))
    else setError(t('settings.ai.utility.saveFailed'))
    setSaving(false)
  }

  return (
    <div data-ai-settings-section="utility">
      <SettingsSection title={t('settings.ai.utility.title')} description={t('settings.ai.utility.description')}>
        <SettingsCard>
          <SettingsMenuSelectRow
            label={t('settings.ai.connection')}
            value={connection?.slug ?? ''}
            disabled={saving || !connections.length}
            onValueChange={slug => { setSelectedSlug(slug); setError(undefined) }}
            options={connections.map(item => ({ value: item.slug, label: item.name }))}
          />
          <SettingsMenuSelectRow
            label={t('settings.ai.utility.model')}
            description={t('settings.ai.utility.modelDescription')}
            value={connection?.utilityModel ?? 'automatic'}
            disabled={saving || !connection}
            onValueChange={value => void save(value)}
            options={[
              { value: 'automatic', label: t('settings.ai.utility.automatic'),
                description: options.find(model => model.value === automaticModel)?.label ?? automaticModel },
              ...options,
            ]}
          />
          {error && <p role="alert" className="px-4 pb-4 text-meta text-destructive">{error}</p>}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
