import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { AssistantWork, WorkerConfig } from '@phaneris/session-tools-core/delegation-contracts'
import type { WorkerControl } from '@phaneris/session-tools-core/worker-control-contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Intent = WorkerControl extends infer C ? C extends WorkerControl ? Omit<C, 'commandId' | 'id' | 'expectedSeq'> : never : never

/** Commands retain their identity while in flight; the Host returns actual application. */
export function WorkerManagement({ workspaceId, work, connected, onChange }: {
  workspaceId: string; work: AssistantWork; connected: boolean; onChange(work: AssistantWork): void
}) {
  const { t } = useTranslation()
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [connections, setConnections] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listLlmConnections>>>([])
  const [sources, setSources] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getSources>>>([])
  const [config, setConfig] = React.useState<WorkerConfig>(() => ({ ...work.effectiveConfig }))
  const [catalogLoaded, setCatalogLoaded] = React.useState(false)
  const generation = React.useRef(0)
  React.useEffect(() => () => { generation.current++ }, [workspaceId, work.id])
  const actions = work.controlAvailability?.actions ?? []
  const disabled = busy || !connected || !!work.pendingControlId
  const command = async (intent: Intent) => {
    const token = ++generation.current
    setBusy(true); setError(undefined)
    const result = await Promise.allSettled([window.electronAPI.controlAssistantWork(workspaceId, {
      ...intent, commandId: crypto.randomUUID(), id: work.id, expectedSeq: work.seq,
    })])
    if (token !== generation.current) return
    if (result[0].status === 'fulfilled') { onChange(result[0].value.work); if (intent.action === 'message') setMessage('') }
    else setError(String(result[0].reason))
    setBusy(false)
  }
  const loadCatalog = async () => {
    const token = generation.current
    const result = await Promise.allSettled([window.electronAPI.listLlmConnections(), window.electronAPI.getSources(workspaceId)])
    if (token !== generation.current) return
    if (result[0].status === 'fulfilled' && result[1].status === 'fulfilled') {
      setConnections(result[0].value); setSources(result[1].value); setCatalogLoaded(true)
    } else setError(String(result.find(item => item.status === 'rejected')?.reason))
  }
  const connection = connections.find(item => item.slug === config.llmConnection)
  return <div className="mt-4 space-y-3" aria-busy={busy}>
    <div className="resident-work-actions">
      {(['pause', 'resume', 'retry'] as const).filter(action => actions.includes(action)).map(action => <Button key={action} size="sm" variant="outline" disabled={disabled}
        onClick={() => void command({ action })}>{t(`residentAssistant.control.${action}`)}</Button>)}
    </div>
    {actions.includes('message') && <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (message.trim()) void command({ action: 'message', message: message.trim() }) }}>
      <label className="block text-label space-y-1"><span>{t('residentAssistant.control.supplement')}</span>
        <Textarea value={message} maxLength={6000} rows={3} disabled={disabled} onChange={event => setMessage(event.target.value)} /></label>
      <Button size="sm" variant="outline" type="submit" disabled={disabled || !message.trim()}>{t('residentAssistant.control.send')}</Button>
    </form>}
    {actions.includes('configure') && <details className="resident-work-disclosure text-label" onToggle={event => { if (event.currentTarget.open && !catalogLoaded) void loadCatalog() }}>
      <summary className="craft-control resident-panel-summary">{t('residentAssistant.control.configure')}</summary>
      <form className="space-y-3 mt-2" onSubmit={event => { event.preventDefault(); void command({ action: 'configure', config }) }}>
        <label className="block space-y-1"><span>{t('residentAssistant.control.connection')}</span>
          <select className="craft-control w-full rounded-md border border-border bg-background p-2" disabled={disabled || !catalogLoaded} value={config.llmConnection ?? ''} onChange={event => {
            const selected = connections.find(item => item.slug === event.target.value)
            setConfig(current => ({ ...current, llmConnection: event.target.value, model: selected?.defaultModel }))
          }}>{connections.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        <label className="block space-y-1"><span>{t('residentAssistant.control.model')}</span>
          <Input disabled={disabled || !catalogLoaded} value={config.model ?? ''} list={`worker-models-${work.id}`} onChange={event => setConfig(current => ({ ...current, model: event.target.value }))} />
          <datalist id={`worker-models-${work.id}`}>{connection?.models?.map(model => <option key={typeof model === 'string' ? model : model.id} value={typeof model === 'string' ? model : model.id} />)}</datalist></label>
        <label className="block space-y-1"><span>{t('residentAssistant.control.thinking')}</span>
          <select className="craft-control w-full rounded-md border border-border bg-background p-2" disabled={disabled} value={config.thinkingLevel} onChange={event => setConfig(current => ({ ...current, thinkingLevel: event.target.value as WorkerConfig['thinkingLevel'] }))}>
            {(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map(level => <option key={level} value={level}>{t(`thinking.${level}`)}</option>)}</select></label>
        <label className="block space-y-1"><span>{t('residentAssistant.control.directory')}</span><Input disabled={disabled} placeholder={t('residentAssistant.control.sessionDirectory')} value={config.workingDirectory === 'none' ? '' : config.workingDirectory ?? ''} onChange={event => setConfig(current => ({ ...current, workingDirectory: event.target.value || 'none' }))} /></label>
        {!!sources.length && <fieldset className="space-y-1"><legend className="mb-1">{t('residentAssistant.control.sources')}</legend>{sources.map(source => <label key={source.config.slug} className="flex items-center gap-2 break-words">
          <input className="craft-control" type="checkbox" disabled={disabled || !source.config.enabled} checked={config.enabledSourceSlugs?.includes(source.config.slug) ?? false} onChange={event => setConfig(current => ({ ...current,
            enabledSourceSlugs: event.target.checked ? [...(current.enabledSourceSlugs ?? []), source.config.slug] : current.enabledSourceSlugs?.filter(slug => slug !== source.config.slug) }))} />{source.config.name}</label>)}</fieldset>}
        <p className="text-meta text-text-secondary">{t('residentAssistant.control.boundary')}</p>
        <Button size="sm" variant="outline" disabled={disabled || !catalogLoaded || !config.model?.trim()} type="submit">{t('residentAssistant.control.apply')}</Button>
      </form>
    </details>}
    {error && <p role="alert" className="text-label text-destructive-text break-words">{error}</p>}
    {!!work.controls?.length && <details className="resident-work-disclosure text-label"><summary className="craft-control resident-panel-summary">{t('residentAssistant.control.receipts')}</summary>
      {work.controls.map(receipt => <div key={receipt.commandId} className="py-2 border-b border-border last:border-0">
        <p>{t(`residentAssistant.control.${receipt.action}`)} · {t(`residentAssistant.control.phase.${receipt.phase}`)}</p>
        {receipt.error && <p className="text-meta text-destructive-text break-words">{receipt.error}</p>}
      </div>)}
    </details>}
  </div>
}
