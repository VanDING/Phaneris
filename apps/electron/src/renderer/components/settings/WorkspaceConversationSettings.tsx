import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { getModelOptionsForConnection } from '@/lib/ai-model-options'
import { getModelShortName } from '@config/models'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@phaneris/shared/agent/thinking-levels'
import type { WorkspaceSettings, ThinkingLevel } from '../../../shared/types'
import { SettingsCard, SettingsRow, SettingsSection, SettingsMenuSelectRow } from './index'

type OverrideKey = 'defaultLlmConnection' | 'model' | 'thinkingLevel'

/** Only the active workspace owns these overrides. Mount with its ID as the key. */
export function WorkspaceConversationSettings({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const { llmConnections, refreshLlmConnections } = useAppShellContext()
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  const [thinking, setThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const request = ++generation.current
    setLoading(true); setError(null)
    Promise.all([window.electronAPI.getWorkspaceSettings(workspaceId), window.electronAPI.getDefaultThinkingLevel()]).then(([ws, level]) => {
      if (request !== generation.current) return
      if (!ws) throw new Error(t('settings.ai.workspaceLoadFailed'))
      setSettings(ws); setThinking(level)
    }).catch(failure => { if (request === generation.current) setError(failure instanceof Error ? failure.message : String(failure)) })
      .finally(() => { if (request === generation.current) setLoading(false) })
    return () => { generation.current = request + 1 }
  }, [workspaceId, retry, t])

  const update = useCallback(async (key: OverrideKey, value: string | undefined) => {
    if (!settings || saving || loading) return
    const previous = settings, request = generation.current
    const connection = key === 'defaultLlmConnection' ? llmConnections.find(c => value ? c.slug === value : c.isDefault) : undefined
    const clearModel = key === 'defaultLlmConnection' && !getModelOptionsForConnection(connection).some(m => m.value === settings.model)
    setSaving(true); setError(null)
    setSettings({ ...settings, [key]: value, ...(clearModel ? { model: undefined } : {}) })
    try {
      // The server clears a foreign model in this same write; do not issue a second RPC.
      await window.electronAPI.updateWorkspaceSetting(workspaceId, key, value)
      if (request === generation.current) await refreshLlmConnections?.()
    } catch (failure) {
      if (request !== generation.current) return
      setSettings(previous)
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      toast.error(t('toast.failedToSaveSetting', { setting: t('settings.ai.workspaceModels') }), { description: message })
    } finally { if (request === generation.current) setSaving(false) }
  }, [settings, saving, loading, workspaceId, llmConnections, refreshLlmConnections, t])

  const connection = settings?.defaultLlmConnection ? llmConnections.find(c => c.slug === settings.defaultLlmConnection) : llmConnections.find(c => c.isDefault)
  const models = getModelOptionsForConnection(connection)
  const effectiveModel = settings?.model || connection?.defaultModel || models[0]?.value
  const level = THINKING_LEVELS.find(l => l.id === (settings?.thinkingLevel || thinking))
  const effective = [connection?.name || settings?.defaultLlmConnection, effectiveModel && getModelShortName(effectiveModel), level && t(level.nameKey)].filter(Boolean).join(' · ')
  return <div data-workspace-conversation-settings>
    <SettingsSection title={t('settings.ai.workspaceModels')} description={t('settings.ai.workspaceModelsDesc')}>
      <SettingsCard>
        {settings ? <>
          <SettingsMenuSelectRow label={t('settings.ai.connection')} value={settings.defaultLlmConnection || 'global'} disabled={loading || saving}
            onValueChange={v => void update('defaultLlmConnection', v === 'global' ? undefined : v)}
            options={[{ value: 'global', label: t('settings.ai.useDefault'), description: t('settings.ai.inheritFromApp') },
              ...(settings.defaultLlmConnection && !connection ? [{ value: settings.defaultLlmConnection, label: settings.defaultLlmConnection, description: t('settings.ai.notAuthenticated') }] : []),
              ...llmConnections.map(c => ({ value: c.slug, label: c.name, description: c.authType === 'oauth' ? t('settings.ai.authSubscription') : t('settings.ai.authApiKey') }))]} />
          <SettingsMenuSelectRow label={t('settings.ai.model')} value={settings.model || 'global'} disabled={loading || saving}
            description={t('settings.ai.inheritConnectionModel', { model: getModelShortName(connection?.defaultModel || models[0]?.value || '') })}
            onValueChange={v => void update('model', v === 'global' ? undefined : v)}
            options={[{ value: 'global', label: t('settings.ai.useConnectionDefault'), description: connection?.name },
              ...(settings.model && !models.some(m => m.value === settings.model) ? [{ value: settings.model, label: getModelShortName(settings.model), description: t('settings.ai.unavailableModel') }] : []),
              ...models.map(m => ({ ...m, description: m.descriptionKey ? t(m.descriptionKey) : m.description }))]} />
          <SettingsMenuSelectRow label={t('settings.ai.thinking')} value={settings.thinkingLevel || 'global'} disabled={loading || saving}
            onValueChange={v => void update('thinkingLevel', v === 'global' ? undefined : v)}
            options={[{ value: 'global', label: t('settings.ai.useDefault'), description: t('settings.ai.inheritFromApp') },
              ...THINKING_LEVELS.map(l => ({ value: l.id, label: t(l.nameKey), description: t(l.descriptionKey) }))]} />
        </> : <SettingsRow label={t('settings.ai.workspaceModels')} description={loading ? t('common.loading') : t('settings.ai.workspaceLoadFailed')} />}
      </SettingsCard>
      {settings && <p data-workspace-effective className="text-xs text-muted-foreground px-1">{t('settings.ai.workspaceEffective', { value: effective })}</p>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 px-1 text-sm text-destructive"><span>{error}</span>
        {!settings && <Button variant="outline" size="sm" onClick={() => setRetry(n => n + 1)}>{t('common.retry')}</Button>}
      </div>}
    </SettingsSection>
  </div>
}
