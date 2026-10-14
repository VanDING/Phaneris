/** Browser-safe WorkItem contract and pure projection helpers. */
export { workItemToCalendarEntry, calendarPlanningFields } from './calendar.ts';
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
  rescheduleTimelineRange,
  timelineDayCount,
  toTimelineRange,
  type TimelineRange,
  type TimelineSource,
} from './timeline.ts';
