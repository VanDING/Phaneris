/**
 * Canonical project-management task.
 *
 * A WorkItem describes work independently from the agent conversations that
 * execute it. `sessionIds` is therefore allowed to be empty or contain many
 * sessions; `primarySessionId` only identifies the preferred conversation to
 * open from task-oriented UI.
 */
export interface WorkItem {
  id: string;
  projectId?: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  /** Workspace status id (for example `todo` or `needs-review`). */
  statusId: string;
  /** Physical board placement. Deliberately independent from `statusId`. */
  columnId?: string;
  /**
   * A calendar date (`YYYY-MM-DD`) or local/offset ISO date-time. Date-only
   * values remain date-only so all-day work never shifts across time zones.
   */
  startAt?: string;
  /** Same temporal representation as `startAt`. */
  dueAt?: string;
  /** Integer completion percentage in the inclusive range 0..100. */
  progress?: number;
  /** Work-item ids that must finish before this item. */
  dependencyIds: string[];
  parentId?: string;
  /** Agent conversations and executions associated with this task. */
  sessionIds: string[];
  /** Preferred session when task UI needs to open a conversation. */
  primarySessionId?: string;
  /** A zero-duration marker for future timeline/Gantt projections. */
  isMilestone?: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface CreateWorkItemInput {
  projectId?: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  statusId?: string;
  columnId?: string;
  startAt?: string;
  dueAt?: string;
  progress?: number;
  dependencyIds?: string[];
  parentId?: string;
  sessionIds?: string[];
  primarySessionId?: string;
  isMilestone?: boolean;
}

/** `null` clears an optional scalar field; omitted fields are unchanged. */
export interface UpdateWorkItemInput {
  projectId?: string | null;
  title?: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  statusId?: string;
  columnId?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  progress?: number | null;
  dependencyIds?: string[];
  parentId?: string | null;
  sessionIds?: string[];
  primarySessionId?: string | null;
  isMilestone?: boolean;
  archivedAt?: number | null;
}

export type WorkItemScheduledFilter = 'all' | 'scheduled' | 'unscheduled';
export type WorkItemSortField = 'createdAt' | 'updatedAt' | 'title' | 'startAt' | 'dueAt';
export type WorkItemSortDirection = 'asc' | 'desc';

/** Shared query contract used by List, Board and Calendar projections. */
export interface WorkItemQuery {
  projectIds?: readonly string[];
  statusIds?: readonly string[];
  columnIds?: readonly string[];
  sessionId?: string;
  search?: string;
  scheduled?: WorkItemScheduledFilter;
  /** Inclusive local calendar-day range (`YYYY-MM-DD`). */
  dateRange?: { from?: string; to?: string };
  includeArchived?: boolean;
  sort?: {
    field: WorkItemSortField;
    direction?: WorkItemSortDirection;
  };
}
