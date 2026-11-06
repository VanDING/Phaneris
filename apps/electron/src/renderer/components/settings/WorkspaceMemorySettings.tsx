import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { AssistantMemoryPolicy } from '@phaneris/shared/workspaces'
import { SettingsCard, SettingsMenuSelectRow, SettingsSection, SettingsToggle } from './index'
import { Button } from '@/components/ui/button'
import { announceWorkspaceSettingsChanged } from '@/lib/workspace-settings-events'

/** One mounted workspace owns requests; mode changes do not delete records. */
export function WorkspaceMemorySettings({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [policy, setPolicy] = React.useState<AssistantMemoryPolicy>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [retry, setRetry] = React.useState(0)
  const generation = React.useRef(0)
  const invalidate = React.useCallback(() => { generation.current++ }, [])
  React.useEffect(() => {
    const token = ++generation.current
    setBusy(true); setError(undefined); setPolicy(undefined)
    void Promise.allSettled([window.electronAPI.getWorkspaceSettings(workspaceId)]).then(results => {
      if (token !== generation.current) return
      if (results[0].status === 'fulfilled' && results[0].value?.assistantMemory) setPolicy(results[0].value.assistantMemory)
      else setError(results[0].status === 'rejected' ? String(results[0].reason) : t('settings.memory.unavailable'))
      setBusy(false)
    })
    return invalidate
  }, [workspaceId, retry, t, invalidate])
  const update = async (patch: Partial<AssistantMemoryPolicy>) => {
    if (!policy || busy) return
    const token = generation.current, next = { ...policy, ...patch }
    setBusy(true); setError(undefined)
    const result = await Promise.allSettled([window.electronAPI.updateWorkspaceSetting(workspaceId, 'assistantMemory', next)])
    if (token !== generation.current) return
    if (result[0].status === 'fulfilled') { setPolicy(next); announceWorkspaceSettingsChanged(workspaceId) }
    else setError(String(result[0].reason))
    setBusy(false)
  }
  return <div data-testid="workspace-memory-settings">
    <SettingsSection title={t('settings.memory.title')} description={t('settings.memory.scope')}>
      <SettingsCard>
        <SettingsMenuSelectRow label={t('settings.memory.learning')} ariaLabel={t('settings.memory.learning')}
          value={policy?.learning ?? 'paused'} disabled={!policy || busy}
          onValueChange={learning => void update({ learning: learning as AssistantMemoryPolicy['learning'] })}
          options={(['automatic', 'explicit', 'paused'] as const).map(value => ({ value, label: t(`settings.memory.mode.${value}`), description: t(`settings.memory.modeHint.${value}`) }))} />
        <SettingsToggle label={t('settings.memory.use')} description={t('settings.memory.useHint')} checked={policy?.use ?? false} disabled={!policy || busy} onCheckedChange={use => void update({ use })} />
      </SettingsCard>
      {error && <div role="alert" className="mt-2 text-label text-destructive-text break-words">{error}<Button variant="ghost" size="sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</Button></div>}
    </SettingsSection>
  </div>
}
