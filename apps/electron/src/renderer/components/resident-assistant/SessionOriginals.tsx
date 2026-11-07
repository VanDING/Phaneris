import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionHistoryPage, SessionHistoryQuery } from '@phaneris/session-tools-core/session-history-contracts'
import { Button } from '@/components/ui/button'

export function SessionOriginals({ workspaceId, sessionId, connected }: { workspaceId: string; sessionId: string; connected: boolean }) {
  const { t } = useTranslation()
  const [page, setPage] = React.useState<SessionHistoryPage>()
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)
  const generation = React.useRef(0)
  const invalidate = React.useCallback(() => { generation.current++ }, [])
  React.useEffect(() => {
    const off = window.electronAPI.onAssistantMemoryChanged(event => { if (event.workspaceId === workspaceId) { generation.current++; setPage(undefined); setError(undefined); setLoading(false) } })
    return () => { invalidate(); off() }
  }, [workspaceId, sessionId, invalidate])
  const read = async (query: SessionHistoryQuery) => {
    const token = ++generation.current
    setLoading(true); setError(undefined)
    const result = await Promise.allSettled([window.electronAPI.readAssistantOriginals(workspaceId, sessionId, { limit: 8, maxCharacters: 12000, ...query })])
    if (token !== generation.current) return
    if (result[0].status === 'fulfilled') setPage(result[0].value)
    else setError(String(result[0].reason))
    setLoading(false)
  }
  return <details className="resident-work-disclosure text-label" onToggle={event => { if (event.currentTarget.open && !page && !loading && connected) void read({ fromEnd: true }) }}>
    <summary className="craft-control resident-panel-summary">{t('residentAssistant.control.originals')}</summary>
    <div data-testid="resident-originals" aria-busy={loading}>
      {loading && <p role="status">{t('residentAssistant.loading')}</p>}
      {error && <p role="alert" className="text-destructive-text break-words">{error}</p>}
      {page?.messages.map(message => <div key={`${message.id}:${message.startCharacter}`} className="py-2 border-b border-border">
        <p className="text-meta text-text-secondary">{t(`residentAssistant.control.role.${message.role}`)}{message.toolName ? ` · ${message.toolName}` : ''}{message.inputSource ? ` · ${t('residentAssistant.control.internal')}` : ''}</p>
        <p className="resident-result-text text-label">{message.unavailable ? t('residentAssistant.control.suppressed') : message.content}</p>
        {message.coverage === 'partial' && <p className="text-meta text-text-secondary tabular-nums">{t('residentAssistant.control.range', { start: message.startCharacter, end: message.endCharacter, total: message.characters })}</p>}
      </div>)}
      {page && !page.messages.length && <p>{t('residentAssistant.panel.noHistory')}</p>}
      <div className="resident-work-actions mt-2">
        <Button size="sm" variant="ghost" disabled={loading || !connected} onClick={() => void read({})}>{t('residentAssistant.control.fromStart')}</Button>
        {page?.nextCursor && <Button size="sm" variant="ghost" disabled={loading || !connected} onClick={() => void read({ cursor: page.nextCursor! })}>{t('residentAssistant.panel.loadMore')}</Button>}
      </div>
    </div>
  </details>
}
