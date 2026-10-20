/**
 * Workspace-level chat starters: up to three user-defined prompt chips shown on
 * the new-chat screen.
 *
 * Validation lives here, not in the settings UI, because the RPC is the real
 * boundary: a malformed payload must be rejected rather than stored and rendered
 * later. The limits are deliberately explicit and small — a starter is a prompt
 * prefill, not a document.
 */

/** A user-defined prompt chip. `label` is the chip text, `prompt` is what is sent. */
export interface ChatStarter {
  label: string;
  prompt: string;
}

/** At most this many starters are kept. The original plan's cap. */
export const MAX_CHAT_STARTERS = 3;
/** Chip label limit (characters). Matches the short, scannable chip affordance. */
export const MAX_CHAT_STARTER_LABEL_LENGTH = 60;
/** Prompt limit. Long enough for a real instruction, short enough to review at a glance. */
export const MAX_CHAT_STARTER_PROMPT_LENGTH = 2000;

export class ChatStarterValidationError extends Error {}

/**
 * Validate and normalize a stored/payload value.
 *
 * Returns `undefined` for "no starters" (the caller clears the field), and throws
 * on anything malformed: over the cap, a non-array, a blank label or prompt, a
 * non-string, or an over-long value. Unknown extra keys are dropped so a stored
 * object cannot smuggle fields into the config.
 */
export function normalizeChatStarters(value: unknown): ChatStarter[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ChatStarterValidationError('Chat starters must be a list');
  if (value.length === 0) return undefined;
  if (value.length > MAX_CHAT_STARTERS) {
    throw new ChatStarterValidationError(`At most ${MAX_CHAT_STARTERS} chat starters are allowed`);
  }
  const normalized: ChatStarter[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ChatStarterValidationError(`Chat starter ${index + 1} must be an object with a label and a prompt`);
    }
    const { label, prompt } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || typeof prompt !== 'string') {
      throw new ChatStarterValidationError(`Chat starter ${index + 1} needs a text label and prompt`);
    }
    const trimmedLabel = label.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedLabel) throw new ChatStarterValidationError(`Chat starter ${index + 1} has an empty label`);
    if (!trimmedPrompt) throw new ChatStarterValidationError(`Chat starter ${index + 1} has an empty prompt`);
    if (trimmedLabel.length > MAX_CHAT_STARTER_LABEL_LENGTH) {
      throw new ChatStarterValidationError(
        `Chat starter ${index + 1} label is longer than ${MAX_CHAT_STARTER_LABEL_LENGTH} characters`,
      );
    }
    if (trimmedPrompt.length > MAX_CHAT_STARTER_PROMPT_LENGTH) {
      throw new ChatStarterValidationError(
        `Chat starter ${index + 1} prompt is longer than ${MAX_CHAT_STARTER_PROMPT_LENGTH} characters`,
      );
    }
    normalized.push({ label: trimmedLabel, prompt: trimmedPrompt });
  }
  return normalized;
}

/** Read stored starters without throwing: an invalid stored value is "no starters". */
export function readChatStarters(value: unknown): ChatStarter[] {
  try {
    return normalizeChatStarters(value) ?? [];
  } catch {
    return [];
  }
}
