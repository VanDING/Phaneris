import type { SessionTaskContext } from '../../sessions/types.ts';
import type { SessionHistoryQuery } from '@phaneris/session-tools-core';
export type { SessionHistoryQuery } from '@phaneris/session-tools-core';

export interface TaskInput {
  id?: string;
  role: string;
  content: string;
  hidden?: boolean;
  isQueued?: boolean;
  isIntermediate?: boolean;
  skillSlugs?: readonly string[];
  badges?: readonly { type: string; rawText?: string; filePath?: string }[];
}
export interface TaskArtifact { id: string; status: string; revision?: string | null; path?: string; title?: string }
export interface TaskContinuityContext {
  task: SessionTaskContext;
  messages: Array<{ id?: string; historyOffset: number; content?: string; coverage: 'full' | 'partial'; characters: number; omitted?: boolean }>;
  artifacts: TaskArtifact[];
  omittedInputs?: number;
  selectedSkillMessage?: string;
}

/** Current product/user facts, without semantic extraction or another persisted owner. */
export function projectTaskContinuity(input: { task: SessionTaskContext; messages: readonly TaskInput[]; artifacts?: readonly TaskArtifact[] }, budgetChars = 16_000): TaskContinuityContext {
  const inputs = input.messages.filter(message => message.role === 'user' && !message.hidden && !message.isQueued);
  const visible = input.messages.filter(message => !message.hidden && !message.isIntermediate && (message.role === 'user' || message.role === 'assistant'));
  const maximumInputs = Math.max(1, Math.floor(budgetChars / 220));
  const represented = inputs.length <= maximumInputs ? inputs : [inputs[0]!, ...inputs.slice(-(maximumInputs - 1)).filter(message => message !== inputs[0])].slice(0, maximumInputs);
  const allowance = Math.max(0, Math.min(4000, Math.floor(budgetChars / Math.max(1, represented.length)) - 180));
  const selected = inputs.findLast(message => message.skillSlugs !== undefined || /\[skill:[^\]]+\]/.test(message.content) || message.badges?.some(badge => badge.type === 'skill'));
  return { task: { ...input.task }, messages: represented.map(message => ({
    id: message.id, historyOffset: visible.indexOf(message), content: allowance ? message.content.slice(0, allowance) : undefined,
    coverage: message.content.length <= allowance ? 'full' : 'partial', characters: message.content.length,
    ...(allowance ? {} : { omitted: true }),
  })), artifacts: (input.artifacts ?? []).map(artifact => ({ ...artifact })),
    ...(inputs.length > represented.length ? { omittedInputs: inputs.length - represented.length } : {}),
    selectedSkillMessage: selected?.skillSlugs !== undefined ? selected.skillSlugs.map(slug => `[skill:${slug}]`).join(' ')
      : selected ? [...(selected.content.match(/\[skill:[^\]\n]+\]/g) ?? []), ...(selected.badges?.filter(badge => badge.type === 'skill').map(badge => badge.rawText ?? '') ?? [])].join(' ') : undefined };
}

export function formatTaskContinuity(context: TaskContinuityContext | undefined): string {
  if (!context) return '';
  return `<task_continuity>\nCurrent product/user records, not model conclusions or new approval. Read partial/omitted bodies using get_session_info with sessionId=task.id and history.messageId plus character ranges; legacy messages without IDs use history.offset=historyOffset. Omitted inputs remain in paginated original history. Current task fields supersede old product fields; current user corrections govern subsequent work. Artifact revisions are current product facts, not proof of validation. Use existing plan/work files for optional working notes; short tasks need no checkpoint ritual.\n${JSON.stringify(context)}\n</task_continuity>`;
}

/** Exact ranges from existing history; never silently substitute a different message. */
export function readTaskHistory(messages: readonly TaskInput[], query: SessionHistoryQuery = {}) {
  const offset = query.offset ?? 0, limit = query.limit ?? 8, start = query.startCharacter ?? 0, maximum = query.maxCharacters ?? 12_000;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32_000) throw new Error('Invalid history range');
  const visible = messages.filter(message => !message.hidden && !message.isIntermediate && (message.role === 'user' || message.role === 'assistant'));
  const matching = query.messageId ? visible.filter(message => message.id === query.messageId) : visible;
  if (query.messageId && !matching.length) throw new Error(`Message not found: ${query.messageId}`);
  const page = matching.slice(offset, offset + limit);
  let remaining = maximum;
  return { total: matching.length, offset, hasMore: offset + page.length < matching.length,
    nextOffset: offset + page.length < matching.length ? offset + page.length : null,
    messages: page.map(message => {
      const beginning = Math.min(start, message.content.length);
      const content = message.content.slice(beginning, beginning + remaining);
      remaining -= content.length;
      const end = beginning + content.length;
      return { id: message.id, historyOffset: visible.indexOf(message), role: message.role, content,
        coverage: beginning === 0 && end === message.content.length ? 'full' : 'partial', startCharacter: beginning, endCharacter: end,
        characters: message.content.length, nextCharacter: end < message.content.length ? end : null };
    }) };
}
