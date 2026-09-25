/**
 * TaskEditorOverlay — the one create/edit surface for project work.
 *
 * It used to live inside the board, which meant the editor could only be opened by
 * first navigating to the board: the calendar and the timeline had their own
 * reduced forms instead, and "New Task" from either of them jumped the user into a
 * different projection. The editor covers the whole surface, so it belongs at the
 * surface level — any projection can open it and stay where it was.
 *
 * The target is an atom rather than local state for the same reason it always was:
 * the tile click, the calendar chip, the "New" buttons and the chat header all need
 * to point the same editor at a different row.
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { DEFAULT_MODEL } from '@config/models'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { buildModelCatalog } from '@/components/app-shell/kanban/model-catalog'
import { TaskEditor } from '@/components/app-shell/kanban/TaskEditor'

export function TaskEditorOverlay() {
  const [target, setTarget] = useAtom(kanbanEditorTargetAtom)
  const { activeWorkspaceId, llmConnections, onJumpToTaskSessions } = useAppShellContext()
  const { navigateToSession } = useNavigation()

  const { groups: modelGroups, modelToConnection } = React.useMemo(
    () => buildModelCatalog(llmConnections ?? []),
    [llmConnections],
  )
  const defaultModel = modelToConnection.has(DEFAULT_MODEL) ? DEFAULT_MODEL : undefined

  if (!target || !activeWorkspaceId) return null

  return (
    <div className="absolute inset-0 z-30 bg-background" data-task-editor-overlay>
      <TaskEditor
        workspaceId={activeWorkspaceId}
        target={target}
        onClose={() => setTarget(null)}
        onOpenSession={
          target.mode === 'edit'
            ? () => {
                const sessionId = target.sessionId
                setTarget(null)
                navigateToSession(sessionId)
              }
            : undefined
        }
        onOpenChildSession={(sessionId) => {
          setTarget(null)
          navigateToSession(sessionId)
        }}
        onCreated={({ sessionId, taskLabelId, projectId: createdProjectId }) => {
          // Same human-clearable scope as a tile click; no label (fail-soft) → plain open.
          if (taskLabelId && onJumpToTaskSessions) {
            onJumpToTaskSessions(sessionId, { labelId: taskLabelId, projectId: createdProjectId })
          } else {
            navigateToSession(sessionId)
          }
        }}
        modelGroups={modelGroups}
        modelToConnection={modelToConnection}
        defaultModel={defaultModel ?? DEFAULT_MODEL}
      />
    </div>
  )
}
