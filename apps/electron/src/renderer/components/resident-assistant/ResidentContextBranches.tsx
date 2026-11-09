import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useInitialFocus } from '@phaneris/ui'
import type { ResidentContextCommand, ResidentContextState } from '@phaneris/session-tools-core/resident-context-contracts'

/** Navigation and attribution use the same Host commands as the assistant. */
export function ResidentContextBranches({ workspaceId, context, onChange, onError }: {
  workspaceId: string; context: ResidentContextState; onChange: (value: ResidentContextState) => void; onError: (error: string) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = React.useState<ResidentContextState['branches']>()
  const [query, setQuery] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [target, setTarget] = React.useState('')
  const [sourceId, setSourceId] = React.useState('')
  const generation = React.useRef({ value: 0 })
  const searchFocus = useInitialFocus<HTMLInputElement>()
  React.useEffect(() => {
    const clock = generation.current, current = ++clock.value
    window.electronAPI.residentAssistantContext(workspaceId, { action: 'branches', query, limit: 12 })
      .then(result => { if (clock.value === current) setPage(result.branches) })
      .catch(error => { if (clock.value === current) onError(String(error)) })
    return () => { clock.value++ }
  }, [workspaceId, context.revision, query, onError])
  async function command(value: ResidentContextCommand) {
    setBusy(true)
    try { onChange(await window.electronAPI.residentAssistantContext(workspaceId, value)) }
    catch (error) { onError(String(error)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3" data-testid="resident-context-branches" aria-busy={busy}>
    <h3 className="font-medium">{t('residentAssistant.branches')}</h3>
    <input ref={searchFocus} className="craft-control craft-field-input resident-input w-full" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('residentAssistant.searchBranches')} placeholder={t('residentAssistant.searchBranches')} />
    <ul className="divide-y divide-border">{page?.items.map(branch => <li key={branch.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0 break-words">{branch.label}<span className="ml-2 text-meta text-text-secondary">{t(`residentAssistant.branchState.${branch.state}`)}</span></span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={busy} aria-pressed={context.selectedBranchIds?.includes(branch.id)} onClick={() => void command({ action: 'select', branchIds: [branch.id] })}>{t('residentAssistant.restoreBranch')}</Button>
        <Button variant="ghost" size="sm" disabled={busy || branch.state === 'dormant'} onClick={() => void command({ action: 'hibernate', branchIds: [branch.id] })}>{t('residentAssistant.hibernateBranch')}</Button>
      </div>
    </li>)}</ul>
    {page?.total === 0 && <p className="text-label text-text-secondary">{t('residentAssistant.noBranches')}</p>}
    {page && <p className="text-meta text-text-secondary tabular-nums">{t('residentAssistant.branchCoverage', { shown: page.items.length, total: page.total })}</p>}
    {page?.nextOffset !== null && page?.nextOffset !== undefined && <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
      setBusy(true)
      try { const next = await window.electronAPI.residentAssistantContext(workspaceId, { action: 'branches', query, offset: page.nextOffset!, limit: 12 }); setPage(next.branches ? { ...next.branches, items: [...page.items, ...next.branches.items] } : undefined) }
      catch (error) { onError(String(error)) }
      finally { setBusy(false) }
    }}>{t('residentAssistant.loadMore')}</Button>}
    {!!context.activeSegment?.materials?.length && <details>
      <summary className="craft-control cursor-pointer text-label">{t('residentAssistant.selectedMaterials')}</summary>
      <ul className="space-y-2 py-2">{context.activeSegment.materials.map((source, i) => <li key={i} className="text-meta break-all">
        {source.sessionId} / {source.messageId} · {source.range?.offset ?? 0}–{source.range?.end ?? source.characters}
      </li>)}</ul>
    </details>}
    <form className="space-y-2" onSubmit={event => {
      event.preventDefault()
      if (target && sourceId) void command({ action: 'associate', branchIds: [target], source: { sessionId: context.sessionId, messageId: sourceId }, role: 'evidence',
        moveFromBranchIds: (context.selectedBranchIds ?? []).filter(id => id !== target) })
    }}>
      <label className="block text-label" htmlFor="context-source-id">{t('residentAssistant.correctAttribution')}</label>
      <input id="context-source-id" className="craft-control craft-field-input resident-input w-full" value={sourceId} onChange={event => setSourceId(event.target.value)} placeholder={t('residentAssistant.sourceMessageId')} required />
      <select className="craft-control craft-field-input resident-input w-full" value={target} onChange={event => setTarget(event.target.value)} aria-label={t('residentAssistant.branches')} required>
        <option value="">{t('residentAssistant.restoreBranch')}</option>
        {page?.items.map(branch => <option key={branch.id} value={branch.id}>{branch.label}</option>)}
      </select>
      <Button variant="secondary" size="sm" type="submit" disabled={busy || !target || !sourceId}>{t('residentAssistant.correctAttribution')}</Button>
    </form>
  </section>
}
