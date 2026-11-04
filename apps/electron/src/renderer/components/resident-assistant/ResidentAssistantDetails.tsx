import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { navigate, routes } from '@/lib/navigate'
import type { HistoryPage, MemoryQueryResult, MemoryRecord, MemorySourceResult } from '@phaneris/shared/protocol'
import type { SessionDelegationInput } from '@phaneris/core/types'
import type { ResidentContextState, ResidentEventsPage } from '@phaneris/session-tools-core/resident-context-contracts'

export type AssistantDetail = 'memory' | 'context' | 'history' | 'work'

export function ResidentAssistantDetails({ workspaceId, detail }: { workspaceId: string; detail: AssistantDetail }) {
  const { t } = useTranslation()
  const [memory, setMemory] = React.useState<MemoryQueryResult>()
  const [context, setContext] = React.useState<ResidentContextState>()
  const [events, setEvents] = React.useState<ResidentEventsPage>()
  const [history, setHistory] = React.useState<HistoryPage>()
  const [execution, setExecution] = React.useState<SessionDelegationInput>()
  const [source, setSource] = React.useState<MemorySourceResult>()
  const [query, setQuery] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const generation = React.useRef({ value: 0 })
  const refresh = React.useCallback(async () => {
    const current = ++generation.current.value
    setLoading(true); setError(undefined)
    const result = await Promise.allSettled([
      detail === 'memory' ? window.electronAPI.queryAssistantMemory(workspaceId, { text: query, includeRetired: true, limit: 100 }) : Promise.resolve(undefined),
      detail === 'context' ? window.electronAPI.residentAssistantContext(workspaceId, { action: 'get' }) : Promise.resolve(undefined),
      detail === 'work' ? window.electronAPI.residentAssistantEvents(workspaceId, { limit: 100 }) : Promise.resolve(undefined),
      detail === 'history' ? window.electronAPI.queryAssistantHistory(workspaceId, { query, limit: 20 }) : Promise.resolve(undefined),
    ])
    if (current !== generation.current.value) return
    const [a, b, c, d] = result
    if (a.status === 'fulfilled') setMemory(a.value)
    if (b.status === 'fulfilled') setContext(b.value)
    if (c.status === 'fulfilled') setEvents(c.value)
    if (d.status === 'fulfilled') setHistory(d.value)
    const failure = result.find(item => item.status === 'rejected')
    if (failure?.status === 'rejected') setError(String(failure.reason))
    setLoading(false)
  }, [workspaceId, detail, query])
  React.useEffect(() => { const clock = generation.current; void refresh(); return () => { clock.value++ } }, [refresh, revision])
  React.useEffect(() => window.electronAPI.onAssistantMemoryChanged(event => { if (event.workspaceId === workspaceId) { generation.current.value++; setSource(undefined); setExecution(undefined); setRevision(value => value + 1) } }), [workspaceId])
  async function readSource(sessionId: string, messageId: string, expectedContentHash?: string) {
    setError(undefined)
    const version = generation.current.value
    try { const result = await window.electronAPI.readAssistantMemorySource(workspaceId, { sessionId, messageId, expectedContentHash }); if (version === generation.current.value) setSource(result) }
    catch (error) { setError(String(error)); setSource(undefined) }
  }
  const goToSession = (sessionId: string) => navigate(routes.view.allSessions(sessionId))
  return <div className="resident-details-content text-body">
    <div className="flex items-center justify-between gap-3">
      <p className="text-meta text-text-secondary">{t(detail === 'work' ? 'residentAssistant.workHint' : 'residentAssistant.workspaceScope')}</p>
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>{t('residentAssistant.refresh')}</Button>
    </div>
    {error && <p className="text-destructive text-label" role="alert">{error}</p>}
    {loading && <p className="text-label text-text-secondary" role="status">{t('residentAssistant.loading')}</p>}
    {(detail === 'memory' || detail === 'history') && <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void refresh() }}>
      <input className="craft-control craft-field-input resident-input min-w-0 flex-1" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('residentAssistant.search')} placeholder={t('residentAssistant.search')} />
    </form>}
    {detail === 'memory' && <div className="divide-y divide-border">{memory?.items.map(record => <MemoryRow key={record.id} record={record} workspaceId={workspaceId}
      onChange={() => setRevision(value => value + 1)} onRead={source => void readSource(source.sessionId, source.messageId, source.contentHash)} onError={setError} />)}
      {memory?.items.length === 0 && <p className="py-6 text-text-secondary">{t('residentAssistant.noMemory')}</p>}
      {memory?.nextCursor && <p className="text-meta text-text-secondary">{t('residentAssistant.moreResults')}</p>}
    </div>}
    {detail === 'history' && history && <>
      <p className="text-label text-text-secondary">{t('residentAssistant.coverage', { indexed: history.coverage.indexedSessions, total: history.coverage.discoveredSessions,
        pending: history.coverage.pendingSessions, unreadable: history.coverage.unreadableSessions })}</p>
      <p data-testid="resident-extraction-coverage" className="text-label text-text-secondary">{t('residentAssistant.extractionCoverage', {
        processed: history.extraction.processedMessages, partial: history.extraction.partialMessages, pending: history.extraction.pendingMessages,
        unavailable: history.extraction.unavailableMessages, attachments: history.extraction.unparsedAttachmentMessages })}</p>
      <div className="divide-y divide-border">{history.items.map(item => <article key={`${item.sessionId}:${item.messageId}`} className="py-4 space-y-2">
        <p className="text-meta text-text-secondary break-all">{item.projectId ?? item.sessionId} · {item.role}</p>
        <p className="whitespace-pre-wrap break-words">{item.snippet}</p>
        <Button variant="ghost" size="sm" onClick={() => void readSource(item.sessionId, item.messageId, item.contentHash)}>{t('residentAssistant.readSource')}</Button>
      </article>)}</div>
      {history.items.length === 0 && <p className="text-text-secondary">{t('residentAssistant.noHistory')}</p>}
      {history.nextCursor && <Button variant="ghost" size="sm" onClick={async () => {
        try { const next = await window.electronAPI.queryAssistantHistory(workspaceId, { query, limit: 20, cursor: history.nextCursor! }); setHistory({ ...next, items: [...history.items, ...next.items] }) }
        catch (error) { setError(String(error)) }
      }}>{t('residentAssistant.loadMore')}</Button>}
    </>}
    {detail === 'context' && context && <div data-testid="resident-context-details" className="space-y-5">
      <div><h3 className="font-medium">{context.focus.label}</h3><p className="text-label text-text-secondary">{t('residentAssistant.contextHint')}</p></div>
      <form className="space-y-2" onSubmit={async event => {
        event.preventDefault()
        if (!label.trim()) return
        try { setContext(await window.electronAPI.residentAssistantContext(workspaceId, { action: 'focus', label: label.trim(), anchors: [] })); setLabel('') }
        catch (error) { setError(String(error)) }
      }}><label className="text-label" htmlFor="resident-focus-label">{t('residentAssistant.newTopic')}</label>
        <input id="resident-focus-label" className="craft-control craft-field-input resident-input w-full" value={label} onChange={event => setLabel(event.target.value)} required />
        <Button variant="secondary" size="sm" type="submit">{t('residentAssistant.beginTopic')}</Button>
      </form>
      <div className="space-y-2"><h3 className="font-medium">{t('residentAssistant.workingSet')}</h3>
        {context.focus.anchors.map(anchor => <article key={`${anchor.sessionId}:${anchor.messageId}`} className="space-y-1">
          <p className="text-meta break-all">{anchor.sessionId} / {anchor.messageId}</p>
          <Button variant="ghost" size="sm" onClick={async () => {
            try { setContext(await window.electronAPI.residentAssistantContext(workspaceId, { action: 'anchors', anchors: context.focus.anchors.filter(item => item !== anchor) })) }
            catch (error) { setError(String(error)) }
          }}>{t('residentAssistant.unpinSource')}</Button>
        </article>)}
      </div>
      {context.activeSegment ? <>
        <p className="text-meta text-text-secondary break-all">{t('residentAssistant.segment')}: {context.activeSegment.id}</p>
        <h3 className="font-medium">{t('residentAssistant.originalRequirements')}</h3>
        <ul className="space-y-2">{context.activeSegment.selectedInputs.map(id => <li key={id} className="text-meta break-all"><button className="craft-control underline underline-offset-4" onClick={() => void readSource(context.sessionId, id)}>{id}</button></li>)}</ul>
        <h3 className="font-medium">{t('residentAssistant.actualRequests')}</h3>
        {context.activeSegment.requests.map(request => <article key={request.providerRequestId} className="space-y-1 border-b border-border pb-3">
          <p className="text-label">{request.snapshot?.model} · {request.disposition}</p>
          <p className="text-meta text-text-secondary tabular-nums">{request.snapshot?.capacity?.usedTokens ?? '—'} / {request.snapshot?.capacity?.windowTokens ?? '—'}</p>
          <p className="font-mono text-meta break-all">{request.requestHash}</p>
        </article>)}
      </> : <p className="text-text-secondary">{t('residentAssistant.contextPending')}</p>}
    </div>}
    {detail === 'work' && <div className="divide-y divide-border">{events?.items.filter(event => ['result_ready', 'failed', 'needs_attention', 'decision_requested'].includes(event.kind)).map(event => <article key={event.eventId} className="py-4 space-y-2">
      <p className="font-medium">{t(`residentAssistant.event.${event.kind}`, event.kind)}</p>
      <p className="text-label text-text-secondary">{t(`residentAssistant.phase.${event.phase}`, event.phase)}</p>
      <p className="text-meta break-all">{event.delegationId}</p>
      {event.sessionId && event.inputMessageId && <Button variant="ghost" size="sm" onClick={async () => {
        try { const session = await window.electronAPI.getSessionMessages(event.sessionId!); setExecution(session?.messages.find(message => message.id === event.inputMessageId)?.delegationInput) }
        catch (error) { setError(String(error)) }
      }}>{t('residentAssistant.executionConfig')}</Button>}
      {event.result && <Button variant="ghost" size="sm" onClick={() => void readSource(event.result!.sessionId, event.result!.messageId)}>{t('residentAssistant.readResult')}</Button>}
      {event.request && <p className="text-label text-text-secondary">{t('residentAssistant.originalDecisionHint')}</p>}
      {event.sessionId && <Button variant="secondary" size="sm" onClick={() => goToSession(event.request?.sessionId ?? event.sessionId!)}>{t(event.request ? 'residentAssistant.openDecision' : 'residentAssistant.openSession')}</Button>}
    </article>)}{events?.items.length === 0 && <p className="py-6 text-text-secondary">{t('residentAssistant.noWork')}</p>}</div>}
    {execution && <section className="space-y-3 border-t border-border pt-4">
      <h3 className="font-medium">{t('residentAssistant.executionConfig')}</h3>
      <table className="w-full table-fixed text-meta"><thead><tr><th className="text-left">{t('residentAssistant.setting')}</th><th>{t('residentAssistant.requested')}</th><th>{t('residentAssistant.effective')}</th></tr></thead>
        <tbody>{Object.keys(execution.effectiveConfig).map(key => <tr key={key} className="border-b border-border"><td className="break-all py-2">{key}</td><td className="break-all p-2">{JSON.stringify(execution.requestedConfig[key as keyof typeof execution.requestedConfig]) ?? '—'}</td><td className="break-all p-2">{JSON.stringify(execution.effectiveConfig[key as keyof typeof execution.effectiveConfig])}</td></tr>)}</tbody>
      </table>
      {execution.adjustments.map(reason => <p key={reason} className="text-label text-text-secondary">{reason}</p>)}
    </section>}
    {source && <section className="space-y-3 border-t border-border pt-4">
      <h3 className="font-medium">{t('residentAssistant.source')}</h3>
      <p className="text-meta text-text-secondary break-all">{source.sessionId} / {source.messageId} · {source.role}</p>
      <pre className="whitespace-pre-wrap break-words font-sans text-label">{source.content}</pre>
      <Button variant="secondary" size="sm" data-testid="resident-pin-source" onClick={async () => {
        try {
          const current = await window.electronAPI.residentAssistantContext(workspaceId, { action: 'get' })
          const anchors = current.focus.anchors.filter(item => item.sessionId !== source.sessionId || item.messageId !== source.messageId)
          setContext(await window.electronAPI.residentAssistantContext(workspaceId, { action: 'anchors', anchors: [...anchors, { sessionId: source.sessionId, messageId: source.messageId, expectedContentHash: source.contentHash }] }))
        } catch (error) { setError(String(error)) }
      }}>{t('residentAssistant.pinSource')}</Button>
      <Button variant="ghost" size="sm" onClick={() => goToSession(source.sessionId)}>{t('residentAssistant.openSession')}</Button>
    </section>}
  </div>
}

function MemoryRow({ record, workspaceId, onChange, onRead, onError }: { record: MemoryRecord; workspaceId: string; onChange(): void;
  onRead(source: MemoryRecord['sources'][number]): void; onError(error: string | undefined): void }) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [content, setContent] = React.useState(record.content ?? '')
  const [confirmForget, setConfirmForget] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const effectiveOrScheduled = record.state === 'active' || record.state === 'scheduled'
  async function change(state?: 'active' | 'dormant' | 'invalidated' | 'forgotten') {
    setBusy(true); onError(undefined)
    try {
      await window.electronAPI.mutateAssistantMemory(workspaceId, state
        ? { action: 'transition', requestId: crypto.randomUUID(), id: record.id, expectedRevision: record.revision, state }
        : { action: 'revise', requestId: crypto.randomUUID(), id: record.id, expectedRevision: record.revision, content,
          sources: record.sources.map(({ sessionId, messageId }) => ({ sessionId, messageId })) })
      setEditing(false); setConfirmForget(false); onChange()
    } catch (error) { onError(String(error)) } finally { setBusy(false) }
  }
  return <article className="py-4 space-y-3">
    <p className="text-meta text-text-secondary">{record.dispute ? t('residentAssistant.memoryDisputed') : t(`residentAssistant.memoryState.${record.state}`, record.state)} · {record.basis} · r{record.revision}</p>
    {!record.redacted && (record.condition || record.validFrom !== undefined || record.validUntil !== undefined) && <p data-testid="resident-memory-validity" className="text-meta text-text-secondary">{t('residentAssistant.memoryValidity', {
      condition: record.condition ?? t('residentAssistant.unconditional'), from: record.validFrom === undefined ? '—' : new Date(record.validFrom).toLocaleString(i18n.language),
      until: record.validUntil === undefined ? '—' : new Date(record.validUntil).toLocaleString(i18n.language) })}</p>}
    {editing ? <textarea className="craft-control craft-field-input resident-input w-full min-h-24" value={content} onChange={event => setContent(event.target.value)} aria-label={t('residentAssistant.revise')} />
      : <p className="whitespace-pre-wrap break-words">{record.content ?? t('residentAssistant.forgottenContent')}</p>}
    {record.state !== 'forgotten' && !record.redacted && <div className="flex flex-wrap gap-1">
      {record.state !== 'superseded' && <>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => editing ? void change() : setEditing(true)}>{t(editing ? 'common.save' : 'residentAssistant.revise')}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(effectiveOrScheduled ? 'dormant' : 'active')}>{t(effectiveOrScheduled ? 'residentAssistant.cool' : 'residentAssistant.activate')}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change('invalidated')}>{t('residentAssistant.invalidate')}</Button>
      </>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmForget(true)}>{t('residentAssistant.forget')}</Button>
      {record.sources.map(source => <Button key={`${source.sessionId}:${source.messageId}`} size="sm" variant="ghost" onClick={() => onRead(source)}>{t('residentAssistant.readSource')}</Button>)}
    </div>}
    {confirmForget && <div className="space-y-2" role="alert"><p className="text-label">{t('residentAssistant.forgetHint')}</p>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => void change('forgotten')}>{t('residentAssistant.confirmForget')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirmForget(false)}>{t('common.cancel')}</Button></div>}
  </article>
}
