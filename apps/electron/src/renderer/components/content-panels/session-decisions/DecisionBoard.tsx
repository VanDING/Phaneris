/**
 * Run → Decisions — data container.
 *
 * The panel already loads the unfiltered report; that report owns the two
 * statistic cards (whole scope, never the page). Filters query the server with
 * the same contract the ledger offers, and the preset filters can never offer a
 * bucket the server cannot answer. Rendering lives in `RunDecisionView`
 * (`@phaneris/ui`) so the three redesigned Run views share one visual language.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionDecisionQuery } from '@phaneris/shared/decisions/session'
import { RunDecisionView, type RunDecisionIntent } from '@phaneris/ui'
import { useSessionDecisions } from '@/hooks/useSessionDecisions'

type Data = ReturnType<typeof useSessionDecisions>

export function DecisionBoard({ sessionId, workspaceId, serverScope, data, onOpenChat, onConfigure, onOpenContext, intent }: {
  sessionId: string
  workspaceId?: string
  serverScope?: string
  data: Data
  onOpenChat: (messageId: string) => void
  onConfigure: () => void
  onOpenContext?: (messageId: string) => void
  intent?: RunDecisionIntent
}) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [query, setQuery] = useState<SessionDecisionQuery>({})
  const scoped = Boolean(query.feature || query.status || query.turnId)
  const filtered = useSessionDecisions(sessionId, workspaceId, query, scoped, serverScope)

  // A one-shot intent from another Run view (for example "inspect fallbacks").
  useEffect(() => {
    if (!intent?.nonce) return
    setQuery(current => ({ ...current, status: intent.status, feature: intent.feature }))
  }, [intent?.nonce, intent?.status, intent?.feature])

  const patchQuery = useCallback((patch: Partial<SessionDecisionQuery>) => {
    setQuery(current => ({ ...current, ...patch }))
  }, [])

  const view = scoped ? filtered : data
  return (
    <RunDecisionView
      scope={data.report}
      view={{ state: view.state, report: view.report, paging: view.paging }}
      query={query}
      onQueryChange={patchQuery}
      onLoadMore={view.loadMore}
      onRetry={view.retry}
      onConfigure={onConfigure}
      onOpenChat={onOpenChat}
      onOpenContext={onOpenContext}
      locale={locale}
    />
  )
}
