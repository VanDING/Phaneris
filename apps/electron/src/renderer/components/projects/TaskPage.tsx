import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
} from '@phaneris/shared/work-items/browser'
import type { ProjectManagementView } from '../../../shared/types'
import { projectsAtom } from '@/atoms/projects'
import { kanbanEditorTargetAtom, kanbanProjectFilterAtom } from '@/atoms/kanban'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useWorkItems } from '@/hooks/useWorkItems'
import { WorkItemEditor } from '@/components/app-shell/kanban/WorkItemEditor'

function createInput(patch: UpdateWorkItemInput): CreateWorkItemInput {
  return {
    title: patch.title ?? '',
    description: patch.description ?? undefined,
    acceptanceCriteria: patch.acceptanceCriteria ?? undefined,
    projectId: patch.projectId ?? undefined,
    statusId: patch.statusId,
    startAt: patch.startAt ?? undefined,
    dueAt: patch.dueAt ?? undefined,
    progress: patch.progress ?? undefined,
    dependencyIds: patch.dependencyIds,
    parentId: patch.parentId ?? undefined,
    isMilestone: patch.isMilestone,
  }
}

export function TaskPage({ workItemId, sourceView }: { workItemId: string; sourceView: Exclude<ProjectManagementView, 'overview'> }) {
  const { t } = useTranslation()
  const { activeWorkspaceId, sessionStatuses, onCreateSession } = useAppShellContext()
  const projects = useAtomValue(projectsAtom)
  const projectFilter = useAtomValue(kanbanProjectFilterAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const setTaskEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const { navigate, navigateToSession } = useNavigation()
  const { items, create, update, remove } = useWorkItems(activeWorkspaceId ?? null)
  const isCreate = workItemId === 'new'
  const item = isCreate ? undefined : items.find(({ id }) => id === workItemId)

  const close = React.useCallback(() => {
    navigate(routes.view.projectManagement(sourceView))
  }, [navigate, sourceView])

  React.useEffect(() => {
    if (!isCreate && items.length > 0 && !item) close()
  }, [close, isCreate, item, items.length])

  const draft = React.useMemo<WorkItem>(() => ({
    id: 'new',
    title: '',
    description: undefined,
    projectId: projectFilter[0],
    statusId: 'todo',
    dependencyIds: [],
    sessionIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }), [projectFilter])

  if (!isCreate && !item) {
    return <div className="flex h-full items-center justify-center text-sm text-foreground/45">{t('common.loading')}</div>
  }

  const activeItem = item ?? draft
  const sessionId = item?.primarySessionId
  const meta = sessionId ? metaMap.get(sessionId) : undefined
  const projectOptions = projects.map((project) => ({ id: project.config.id, name: project.config.name }))

  const ensureSession = async () => {
    if (!activeWorkspaceId || !item) return
    const session = await onCreateSession(activeWorkspaceId, {
      name: item.title,
      sessionStatus: item.statusId,
      ...(item.projectId ? { projectId: item.projectId } : {}),
    })
    const linked = await update(item.id, {
      sessionIds: [...item.sessionIds, session.id],
      primarySessionId: session.id,
    })
    if (linked) navigateToSession(session.id)
  }

  return (
    <WorkItemEditor
      key={activeItem.id}
      item={activeItem}
      mode={isCreate ? 'create' : 'edit'}
      projects={projectOptions}
      statuses={sessionStatuses ?? []}
      workItems={items}
      closeAfterSave={false}
      onClose={close}
      onSave={async (patch) => {
        if (isCreate) {
          const created = await create(createInput(patch))
          if (!created) return false
          navigate(routes.view.projectManagement(sourceView))
          return true
        }
        return Boolean(await update(activeItem.id, patch))
      }}
      onDelete={!isCreate ? async () => {
        if (!window.confirm(t('kanban.workItemDeleteConfirm'))) return
        await remove(activeItem.id)
        close()
      } : undefined}
      onOpenSession={sessionId ? () => navigateToSession(sessionId) : undefined}
      onCreateSession={!sessionId && !isCreate ? ensureSession : undefined}
      onEditDefinition={sessionId ? () => {
        setTaskEditorTarget({
          mode: 'edit',
          sessionId,
          taskSlug: meta?.taskSlug,
          initialTitle: activeItem.title,
        })
        navigate(routes.view.projectManagement('board'))
      } : undefined}
    />
  )
}
