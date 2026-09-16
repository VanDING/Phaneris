/**
 * Ask User Handler
 *
 * Puts one or more questions in front of the human and waits for the answer.
 *
 * Unlike SubmitPlan / source_credential_prompt, this does NOT end the turn: the
 * handler blocks on the host callback, and the human's answer is returned to
 * the model as this tool's result. The agent loop then continues normally with
 * the answer in context.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import type { AskUserAnswerItem, AskUserQuestion, AskUserResponse } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface AskUserArgs {
  questions: AskUserQuestion[];
}

/**
 * How long a question may stay open before the handler gives up.
 *
 * The turn is blocked for this whole window, so this is a liveness backstop for
 * the case where nobody can answer any more (client closed, window destroyed,
 * machine locked through the night) — not a pacing control. It must stay
 * comfortably longer than any human decision, and the failure is reported to
 * the model as a recoverable condition so the agent proceeds instead of
 * stalling forever.
 */
export const ASK_USER_TIMEOUT_MS = 15 * 60_000;

/**
 * Validate the assertions no schema can carry.
 *
 * `defineTool`-style argument validation already covers shapes; these are
 * cross-field rules the UI would otherwise have to defend against:
 * an `intent.approve` naming an option the question never offered, and a
 * `plan-review` intent with no plan to review.
 */
function validateQuestions(questions: AskUserQuestion[]): string | null {
  if (questions.length === 0) {
    return 'ask_user requires at least one question.';
  }

  const seen = new Set<string>();
  for (const question of questions) {
    const id = question.id?.trim();
    if (!id) {
      return 'Every question needs a non-empty stable id.';
    }
    if (seen.has(id)) {
      return `Duplicate question id "${id}". Ids must be unique within one call so answers can be routed back.`;
    }
    seen.add(id);

    if (!question.question?.trim()) {
      return `Question "${id}" has empty question text.`;
    }

    for (const option of question.options ?? []) {
      if (!option.label?.trim()) {
        return `Question "${id}" has an option with an empty label. Drop it or give it a label the user can pick.`;
      }
    }

    const intent = question.intent;
    if (!intent) continue;

    if (intent.kind !== 'plan-review') {
      return `Question "${id}" declares unknown intent kind "${String(intent.kind)}". Supported kinds: plan-review.`;
    }
    if (!question.detail?.trim()) {
      return `Question "${id}" declares a plan-review intent but carries no detail. Put the plan markdown in detail.`;
    }
    if (!(question.options ?? []).some(option => option.label === intent.approve)) {
      return `Question "${id}" declares approve label "${intent.approve}", which names none of its options. `
        + 'The approve label must be one of the option labels verbatim.';
    }
  }

  return null;
}

/** Normalize the model's answer shape so the UI can always render every question. */
function normalizeAnswers(
  questions: AskUserQuestion[],
  response: AskUserResponse,
): AskUserAnswerItem[] {
  const byId = new Map(response.answers.map(answer => [answer.id, answer]));
  return questions.map(question => {
    const answer = byId.get(question.id);
    return {
      id: question.id,
      selected: [...(answer?.selected ?? [])],
      ...(answer?.custom === undefined ? {} : { custom: answer.custom }),
    };
  });
}

/**
 * Handle the ask_user tool call.
 *
 * 1. Validate the question batch
 * 2. Hand it to the host, which surfaces it in the UI and resolves on answer
 * 3. Return the answer as this tool's result so the agent loop continues
 */
export async function handleAskUser(
  ctx: SessionToolContext,
  args: AskUserArgs,
): Promise<ToolResult> {
  const questions = args.questions ?? [];

  const validationError = validateQuestions(questions);
  if (validationError) {
    return errorResponse(validationError);
  }

  const onAskUser = ctx.callbacks.onAskUser;
  if (!onAskUser) {
    return errorResponse(
      'Asking the user is unavailable in this session (no interactive client is attached). '
      + 'Proceed using your best judgement, state the assumption you made, and report it in your final answer.'
    );
  }

  const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      onAskUser(requestId, questions),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(
          `no answer after ${Math.round(ASK_USER_TIMEOUT_MS / 60_000)} minutes`,
        )), ASK_USER_TIMEOUT_MS);
      }),
    ]);

    if (response.cancelled) {
      return successResponse(
        'The user dismissed the question without answering. Treat this as "do not block on this": '
        + 'proceed with what is not affected, and state the assumption you made in your final answer. '
        + 'Do not immediately ask the same question again.'
      );
    }

    const answers = normalizeAnswers(questions, response);
    return successResponse(JSON.stringify({ answers }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(
      `ask_user was not answered (${message}). Do not block on it: proceed with the work that is not `
      + 'affected, state the assumption you made, and report it in your final answer.'
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
