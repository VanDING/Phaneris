import * as React from 'react'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { AssistantWork } from '@phaneris/session-tools-core/delegation-contracts'
import type { ResolvedArtifact } from '@phaneris/shared/artifacts'
import { sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'

export function useResidentSnapshot(expanded: boolean) {
  const { t } = useTranslation()
  const { activeWorkspaceId, pendingPermissions, pendingCredentials, pendingQuestions } = useAppShellContext()
  const metadata = useAtomValue(sessionMetaMapAtom)
  const resident = [...metadata.values()].find(session => session.workspaceId === activeWorkspaceId && session.sessionKind === 'resident_assistant')
  const residentId = resident?.id
  const connection = useTransportConnectionState()
  const connected = !connection || connection.status === 'connected'
  const [snapshot, setSnapshot] = React.useState<{ workspaceId: string; work: AssistantWork[]; artifacts: ResolvedArtifact[]; error?: string }>()
  const [revision, refresh] = React.useReducer(value => value + 1, 0)
  const activityAtom = React.useMemo(() => selectAtom(sessionAtomFamily(resident?.id ?? ''), session => {
    if (!session?.isProcessing) return ''
    const tool = session.messages.findLast(message => message.role === 'tool' && (message.toolStatus === 'executing' || message.toolStatus === 'pending'))
    return tool?.toolDisplayMeta?.displayName ?? session.messages.findLast(message => message.role === 'user')?.content ?? ''
  }), [resident?.id])
  const activity = useAtomValue(activityAtom)

  React.useEffect(() => {
    if (!activeWorkspaceId || !connected || !residentId) return
    let cancelled = false
    const workspaceId = activeWorkspaceId
    const read = async () => {
      const work: AssistantWork[] = []
      let after: number | undefined
      do {
        const page = await window.electronAPI.getAssistantWork(workspaceId, { after, limit: 20 })
        work.push(...page.items)
        after = page.nextAfter ?? undefined
      } while (after !== undefined && !cancelled)
      const artifacts = await window.electronAPI.listArtifacts(workspaceId)
      if (!cancelled) setSnapshot({ workspaceId, work, artifacts })
    }
    void read().catch(error => {
      if (cancelled) return
      setSnapshot({ workspaceId, work: [], artifacts: [], error: String(error) })
      toast.error(t('residentAssistant.snapshotError'), { description: String(error), id: 'resident-snapshot-error' })
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, residentId, resident?.lastMessageAt, resident?.isProcessing, connected, connection?.attempt, revision, t])

  React.useEffect(() => {
    const interval = window.setInterval(() => { if (!document.hidden) refresh() }, expanded ? 5000 : 15000)
    const onVisible = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const off = window.electronAPI.onArtifactsChanged(workspaceId => { if (workspaceId === activeWorkspaceId) refresh() })
    return () => { clearInterval(interval); off(); document.removeEventListener('visibilitychange', onVisible) }
  }, [activeWorkspaceId, expanded])
  React.useEffect(() => { if (expanded) refresh() }, [expanded])

  const data = snapshot?.workspaceId === activeWorkspaceId ? snapshot : undefined
  const related = new Set(data?.work.flatMap(work => [work.sessionId, work.execution?.continuationSessionId]).filter((id): id is string => !!id))
  if (resident) related.add(resident.id)
  for (const session of metadata.values()) {
    if (resident && session.workspaceId === activeWorkspaceId && session.parentSessionId === resident.id) related.add(session.id)
  }
  let pendingCount = 0
  for (const id of related) pendingCount += (pendingPermissions.get(id)?.length ?? 0) + (pendingCredentials.get(id)?.length ?? 0) + (pendingQuestions.get(id)?.length ?? 0)
  const currentWork = data?.work.find(work => ['accepted', 'preparing', 'submitting', 'submitted', 'cancel_requested'].includes(work.state))
  const worker = currentWork?.sessionId ? metadata.get(currentWork.sessionId) : undefined
  const processing = resident?.isProcessing || !!currentWork
  const status = !activeWorkspaceId ? 'noWorkspace' : !connected ? 'offline' : data?.error ? 'unavailable' : pendingCount ? 'needsDecision' : processing ? 'working' : 'ready'
  const recentArtifact = data?.artifacts.filter(({ artifact }) => related.has(artifact.sessionId) && ['current', 'ready', 'accepted'].includes(artifact.status))
    .sort((a, b) => b.artifact.updatedAt - a.artifact.updatedAt)[0]?.artifact
  const recentResult = data?.work.filter(work => work.state === 'result_ready').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return {
    workspaceId: activeWorkspaceId, resident, connected, pendingCount, status,
    loading: !!activeWorkspaceId && !!resident && !data,
    error: data?.error,
    current: processing ? (worker?.name ?? (activity || t('residentAssistant.status.working'))) : undefined,
    recent: recentArtifact?.title ?? (recentResult ? metadata.get(recentResult.sessionId ?? '')?.name ?? t('residentAssistant.event.result_ready') : undefined),
  }
}
