import { describe, it, expect } from 'bun:test';
import { handleAskUser } from './ask-user.ts';
import type { SessionToolContext } from '../context.ts';
import type { AskUserQuestion, AskUserResponse } from '../types.ts';

function createCtx(response: AskUserResponse | Error = { answers: [] }): {
  ctx: SessionToolContext;
  calls: Array<{ requestId: string; questions: AskUserQuestion[] }>;
} {
  const calls: Array<{ requestId: string; questions: AskUserQuestion[] }> = [];
  const ctx = {
    callbacks: {
      onAskUser: async (requestId: string, questions: AskUserQuestion[]) => {
        calls.push({ requestId, questions });
        if (response instanceof Error) throw response;
        return response;
      },
    },
  } as unknown as SessionToolContext;
  return { ctx, calls };
}

const singleChoice: AskUserQuestion[] = [{
  id: 'approach',
  question: 'Which approach should I take?',
  options: [
    { label: 'Rewrite the parser (Recommended)' },
    { label: 'Patch the existing parser' },
  ],
}];

describe('handleAskUser', () => {
  it('returns the human answer as JSON so the turn can continue', async () => {
    const { ctx, calls } = createCtx({
      answers: [{ id: 'approach', selected: ['Patch the existing parser'] }],
    });

    const result = await handleAskUser(ctx, { questions: singleChoice });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].questions).toEqual(singleChoice);
    expect(JSON.parse(result.content[0].text)).toEqual({
      answers: [{ id: 'approach', selected: ['Patch the existing parser'] }],
    });
  });

  it('preserves free-text answers and multi-select labels together', async () => {
    const { ctx } = createCtx({
      answers: [{ id: 'scope', selected: ['Docs', 'Tests'], custom: 'and the CLI help' }],
    });

    const result = await handleAskUser(ctx, {
      questions: [{ id: 'scope', question: 'What should I cover?', multiSelect: true }],
    });

    expect(JSON.parse(result.content[0].text).answers[0]).toEqual({
      id: 'scope',
      selected: ['Docs', 'Tests'],
      custom: 'and the CLI help',
    });
  });

  it('keeps a skipped question in the answer batch as an empty selection', async () => {
    const { ctx } = createCtx({ answers: [] });

    const result = await handleAskUser(ctx, { questions: singleChoice });

    expect(JSON.parse(result.content[0].text).answers).toEqual([
      { id: 'approach', selected: [] },
    ]);
  });

  it('reports a dismissal without treating it as a failure', async () => {
    const { ctx } = createCtx({ answers: [], cancelled: true });

    const result = await handleAskUser(ctx, { questions: singleChoice });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('dismissed');
    expect(result.content[0].text).toContain('Do not immediately ask the same question again');
  });

  it('errors instead of blocking when no interactive client is attached', async () => {
    const ctx = { callbacks: {} } as unknown as SessionToolContext;

    const result = await handleAskUser(ctx, { questions: singleChoice });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no interactive client');
  });

  it('surfaces a transport failure as a recoverable tool error', async () => {
    const { ctx } = createCtx(new Error('session torn down'));

    const result = await handleAskUser(ctx, { questions: singleChoice });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('session torn down');
    // The model must be told to proceed rather than stall on an answer that
    // can no longer arrive.
    expect(result.content[0].text).toContain('Do not block on it');
  });

  it('rejects an empty batch without asking', async () => {
    const { ctx, calls } = createCtx();

    const result = await handleAskUser(ctx, { questions: [] });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects duplicate question ids without asking', async () => {
    const { ctx, calls } = createCtx();

    const result = await handleAskUser(ctx, {
      questions: [
        { id: 'same', question: 'A?' },
        { id: 'same', question: 'B?' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Duplicate question id');
    expect(calls).toHaveLength(0);
  });

  it('rejects an option with an empty label without asking', async () => {
    const { ctx, calls } = createCtx();

    const result = await handleAskUser(ctx, {
      questions: [{ id: 'q', question: 'Pick', options: [{ label: '  ' }] }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('empty label');
    expect(calls).toHaveLength(0);
  });

  it('accepts a plan-review intent whose approve label matches an option', async () => {
    const { ctx } = createCtx({ answers: [{ id: 'plan', selected: ['Approve'] }] });

    const result = await handleAskUser(ctx, {
      questions: [{
        id: 'plan',
        question: 'Approve this plan?',
        detail: '# Plan\n\n1. Do the thing',
        options: [{ label: 'Approve' }, { label: 'Refuse' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text).answers[0].selected).toEqual(['Approve']);
  });

  it('rejects a plan-review intent whose approve label names no option', async () => {
    const { ctx, calls } = createCtx();

    const result = await handleAskUser(ctx, {
      questions: [{
        id: 'plan',
        question: 'Approve this plan?',
        detail: '# Plan',
        options: [{ label: 'Yes' }, { label: 'No' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('names none of its options');
    expect(calls).toHaveLength(0);
  });

  it('rejects a plan-review intent with no plan detail', async () => {
    const { ctx, calls } = createCtx();

    const result = await handleAskUser(ctx, {
      questions: [{
        id: 'plan',
        question: 'Approve this plan?',
        options: [{ label: 'Approve' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no detail');
    expect(calls).toHaveLength(0);
  });
});
