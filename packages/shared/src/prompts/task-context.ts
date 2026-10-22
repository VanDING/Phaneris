import type { SessionTaskContext } from '../sessions/types.ts';
import { escapePromptXmlAttr, sanitizePromptBody } from './prompt-sanitize.ts';

/** Live hosts report an empty snapshot too, so clearing fields invalidates historical metadata. */
export function formatTaskContext(task: SessionTaskContext | undefined, includeEmpty = false): string | null {
  if (!task) return null;
  const hasMetadata = task.description || task.acceptanceCriteria || task.progress !== undefined
    || task.startAt || task.dueAt || task.dependencySessionIds?.length || task.parentSessionId;
  if (!hasMetadata) return includeEmpty ? `<task_context session_id="${escapePromptXmlAttr(task.id)}">
Current product task metadata: none. This supersedes earlier task metadata, not user instructions or approvals.
</task_context>` : null;
  const { id, name, description, acceptanceCriteria, progress, startAt, dueAt, dependencySessionIds, parentSessionId, sessionStatus } = task;
  const body = JSON.stringify({ title: name, description, acceptanceCriteria, progress, startAt, dueAt,
    dependencySessionIds, parentSessionId, sessionStatus }, null, 2);
  return `<task_context session_id="${escapePromptXmlAttr(id)}">
Current product task metadata; not approval or verified completion. Latest user instructions and runtime permissions apply.
Progress is reported metadata. Dependency IDs do not prove that dependencies have finished. Use get_session_info for current details when needed.
${sanitizePromptBody(body, ['task_context'])}
</task_context>`;
}
