/**
 * TaskPlanPanel — when the work happens, inside the Task Definition editor.
 *
 * This editor is now the only create and edit surface for project work (the board,
 * the calendar and the timeline all open it), so it has to carry the fields the two
 * pages it replaced used to own. Those pages were not separate stores — a session IS
 * the work item and IS the calendar entry — so nothing here is a new concept, only a
 * new home for status, progress, milestone, parent, dependencies and the plan dates.
 *
 * The plan dates are the interesting half: the calendar's "create here" gesture draws
 * a slot or a range, and that has to arrive as `startAt`/`dueAt` on the session or the
 * gesture is decorative. Plan values therefore use the store's own grammar —
 * `YYYY-MM-DD` for all-day work, `YYYY-MM-DDTHH:mm` for timed work — so a day the user
 * did not give a time keeps no time, instead of acquiring a midnight.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskPlanningInput } from '@phaneris/shared/protocol'
import type { WorkItem } from '@phaneris/shared/work-items/browser'
import { DateField } from '@/components/ui/date-field'
import { ProjectSelectMenu } from '@/components/projects/ProjectSelectMenu'

/** The editable shape, with the time as its own control so "no time" is expressible. */
export interface TaskPlanValue {
  statusId: string
  startDate: string
  startTime: string
  dueDate: string
  dueTime: string
  progress: string
  isMilestone: boolean
  parentId: string
  dependencyIds: string[]
}

export const EMPTY_TASK_PLAN: TaskPlanValue = {
  statusId: '',
  startDate: '',
  startTime: '',
  dueDate: '',
  dueTime: '',
  progress: '',
  isMilestone: false,
  parentId: '',
  dependencyIds: [],
}

/** `YYYY-MM-DD` + optional `HH:mm` -> the store's plan value. */
export function planValueOf(date: string, time: string): string | null {
  if (!date) return null
  return time ? `${date}T${time}` : date
}

/** The reverse, for prefilling the two controls. */
export function splitPlanValue(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: '', time: '' }
  const [date = '', time = ''] = value.split('T')
  return { date, time: time.slice(0, 5) }
}

/** Prefill from the row the board and the calendar both project. */
export function taskPlanFromItem(item: WorkItem | undefined): TaskPlanValue {
  if (!item) return { ...EMPTY_TASK_PLAN }
  const start = splitPlanValue(item.startAt)
  const due = splitPlanValue(item.dueAt)
  return {
    statusId: item.statusId ?? '',
    startDate: start.date,
    startTime: start.time,
    dueDate: due.date,
    dueTime: due.time,
    progress: item.progress === undefined || item.progress === null ? '' : String(item.progress),
    isMilestone: Boolean(item.isMilestone),
    parentId: item.parentId ?? '',
    dependencyIds: [...item.dependencyIds],
  }
}

/**
 * What the create request carries.
 *
 * Values are sent in full and blank means blank: `startAt: null` clears a date, which
 * is the only way the editor can unschedule something. `statusId` is omitted when the
 * picker is empty so the server keeps its own default rather than being handed an
 * empty string it would have to interpret.
 */
export function taskPlanningInput(value: TaskPlanValue): TaskPlanningInput {
  const progress = value.progress.trim() === '' ? null : Number(value.progress)
  return {
    startAt: planValueOf(value.startDate, value.startTime),
    dueAt: planValueOf(value.dueDate, value.dueTime),
    ...(value.statusId ? { statusId: value.statusId } : {}),
    progress: progress === null || Number.isFinite(progress) ? progress : null,
    isMilestone: value.isMilestone,
    parentId: value.parentId || null,
    dependencyIds: value.dependencyIds,
  }
}

export interface TaskPlanPanelProps {
  value: TaskPlanValue
  onChange: (patch: Partial<TaskPlanValue>) => void
  /** Only the id and the visible label are used, so either status shape fits. */
  statuses: readonly { id: string; label: string }[]
  /** Candidates for parent and dependencies; the edited row excludes itself. */
  workItems: readonly WorkItem[]
  selfId?: string
  disabled?: boolean
}

const field =
  'h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none transition-colors focus:border-ring/60'

export function TaskPlanPanel({ value, onChange, statuses, workItems, selfId, disabled }: TaskPlanPanelProps) {
  const { t } = useTranslation()
  const candidates = React.useMemo(
    () => workItems.filter((item) => item.id !== selfId),
    [selfId, workItems],
  )

  return (
    <div className="rounded-xl border border-border/70 bg-foreground/[0.015] p-3">
      <div className="mb-2 text-[12px] font-semibold text-foreground/55">{t('tasks.planSection')}</div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11.5px] font-medium text-foreground/55">
          {t('kanban.workItemStatus')}
          <ProjectSelectMenu
            value={value.statusId}
            options={statuses.map((status) => ({ value: status.id, label: status.label }))}
            onValueChange={(next) => onChange({ statusId: next })}
            ariaLabel={t('kanban.workItemStatus')}
            className="h-8 w-full justify-between"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-medium text-foreground/55">
          {t('kanban.workItemProgress')}
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            className={field}
            value={value.progress}
            onChange={(event) => onChange({ progress: event.target.value })}
          />
        </label>

        {/*
          Date + optional time, side by side. The time control is what keeps all-day
          work all-day: leaving it empty writes a bare date, which is exactly the
          shape the calendar's rail reads back as "no time set".
        */}
        <div className="flex flex-col gap-1 text-[11.5px] font-medium text-foreground/55">
          {t('kanban.workItemStart')}
          <div className="flex items-center gap-1.5">
            <DateField
              value={value.startDate}
              onChange={(next) => onChange({ startDate: next })}
              ariaLabel={t('kanban.workItemStart')}
            />
            <input
              type="time"
              disabled={disabled || !value.startDate}
              aria-label={t('schedule.entryTime')}
              className={`${field} w-28 disabled:opacity-45`}
              value={value.startTime}
              onChange={(event) => onChange({ startTime: event.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11.5px] font-medium text-foreground/55">
          {t('kanban.workItemDue')}
          <div className="flex items-center gap-1.5">
            <DateField
              value={value.dueDate}
              onChange={(next) => onChange({ dueDate: next })}
              min={value.startDate || undefined}
              ariaLabel={t('kanban.workItemDue')}
            />
            <input
              type="time"
              disabled={disabled || !value.dueDate}
              aria-label={t('schedule.entryEndTime')}
              className={`${field} w-28 disabled:opacity-45`}
              value={value.dueTime}
              onChange={(event) => onChange({ dueTime: event.target.value })}
            />
          </div>
        </div>

        <label className="flex h-8 items-center gap-2 self-end rounded-lg border border-border px-2.5 text-[12px] font-medium text-foreground/55">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.isMilestone}
            onChange={(event) => onChange({ isMilestone: event.target.checked })}
          />
          {t('kanban.workItemMilestone')}
        </label>
        {candidates.length > 0 && (
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-foreground/55">
            {t('kanban.workItemParent')}
            <ProjectSelectMenu
              value={value.parentId}
              options={[
                { value: '', label: t('kanban.workItemNoParent') },
                ...candidates.map((item) => ({ value: item.id, label: item.title })),
              ]}
              onValueChange={(next) => onChange({ parentId: next })}
              ariaLabel={t('kanban.workItemParent')}
              className="h-8 w-full justify-between"
            />
          </label>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[11.5px] font-medium text-foreground/55">{t('kanban.workItemDependencies')}</div>
          <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
            {candidates.map((item) => (
              <label key={item.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-[12px] hover:bg-foreground/[0.04]">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value.dependencyIds.includes(item.id)}
                  onChange={(event) => onChange({
                    dependencyIds: event.target.checked
                      ? [...value.dependencyIds, item.id]
                      : value.dependencyIds.filter((id) => id !== item.id),
                  })}
                />
                <span className="truncate">{item.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
