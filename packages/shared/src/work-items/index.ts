/**
 * WorkItem contract and pure projection helpers.
 *
 * A WorkItem is a *projection* of a Session's planning fields — Sessions are the
 * single source of truth. There is no separate WorkItem store: the previous
 * on-disk store, its event log and its one-shot Session migration have all been
 * removed, so nothing here touches the filesystem.
 */
export type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemQuery,
  WorkItemScheduledFilter,
  WorkItemSortDirection,
  WorkItemSortField,
} from './types.ts';

export {
  queryWorkItems,
  reconcileWorkItemSelection,
  workItemDateKey,
} from './query.ts';

export {
  isValidPlanValue,
  isoWeekNumber,
  parsePlanValue,
  planDateKey,
  planDayKeyFromDate,
  planTimeOfDay,
  planRangeError,
  type ParsedPlanValue,
} from './plan-date.ts';

export {
  fromTimelineRange,
  timelineDayCount,
  toTimelineRange,
  type TimelineRange,
  type TimelineSource,
} from './timeline.ts';
