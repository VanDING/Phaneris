import { describe, expect, it } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { wrapDurableModelStream } from './durable-model-stream.ts';

const model = { id: 'test', provider: 'test', api: 'openai-responses' } as Parameters<StreamFn>[0];
const response: AssistantMessage = {
  role: 'assistant', model: 'test', provider: 'test', api: 'openai-responses',
  content: [], timestamp: 1, stopReason: 'toolUse',
  usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 115,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 } },
};

describe('durable model stream', () => {
  it('commits native request evidence with the outcome before publishing completion', async () => {
    const stream = wrapDurableModelStream(async (actualModel, _context, options) => {
      await options?.onPayload?.({ input: 'confidential' }, actualModel);
      await options?.onResponse?.({ status: 200, headers: { 'x-request-id': 'request-123' } }, actualModel);
      const source = createAssistantMessageEventStream();
      source.push({ type: 'done', reason: 'toolUse', message: response });
      return source;
    }, async (_model, _context, evidence) => async () => {
      expect(evidence?.payloads).toHaveLength(1);
      expect(evidence?.responses[0]?.headers['x-request-id']).toBe('request-123');
      expect(JSON.stringify(evidence)).not.toContain('confidential');
    });
    expect((await (await stream(model, { messages: [] })).result()).stopReason).toBe('toolUse');
  });

  it('leaves an indeterminate thrown stream pending instead of committing fabricated zero usage', async () => {
    let commits = 0;
    const stream = wrapDurableModelStream(() => { throw new Error('connection lost after dispatch'); },
      async () => async () => { commits++; });
    expect((await (await stream(model, { messages: [] })).result()).stopReason).toBe('error');
    expect(commits).toBe(0);
  });
  for (const failed of [false, true]) {
    it(`commits ${failed ? 'failed partial' : 'tool-only'} usage before forwarding the response`, async () => {
      const order: string[] = [];
      const context = { messages: [] };
      const options = { apiKey: 'test-only', maxRetries: 2 };
      const message = { ...response, stopReason: failed ? 'error' as const : 'toolUse' as const };
      const stream = wrapDurableModelStream(async (actualModel, actualContext, actualOptions) => {
        order.push('request');
        expect(actualModel).toBe(model);
        expect(actualContext).toBe(context);
        expect(actualOptions).toMatchObject(options);
        const source = createAssistantMessageEventStream();
        source.push(failed
          ? { type: 'error', reason: 'error', error: message }
          : { type: 'done', reason: 'toolUse', message });
        return source;
      }, async () => {
        order.push('prepare');
        return async completed => {
          await Promise.resolve();
          expect(completed.usage.totalTokens).toBe(115);
          order.push('commit');
        };
      });
      for await (const event of await stream(model, context, options)) {
        expect(event.type).toBe(failed ? 'error' : 'done');
        order.push('visible');
      }
      expect(order).toEqual(['prepare', 'request', 'commit', 'visible']);
    });
  }

  it('does not call the provider when preparation fails', async () => {
    let requested = false;
    const stream = wrapDurableModelStream(() => {
      requested = true;
      return createAssistantMessageEventStream();
    }, async () => { throw new Error('ledger unavailable'); });
    const result = await (await stream(model, { messages: [] })).result();
    expect(requested).toBe(false);
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBe('ledger unavailable');
  });

  it('does not publish successful completion when the usage commit fails', async () => {
    const stream = wrapDurableModelStream(() => {
      const source = createAssistantMessageEventStream();
      source.push({ type: 'done', reason: 'toolUse', message: response });
      return source;
    }, async () => async () => { throw new Error('commit failed'); });
    const result = await (await stream(model, { messages: [] })).result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBe('commit failed');
  });
});

describe('durable model stream cache retention', () => {
  it('applies the configured default when callers omit cacheRetention', async () => {
    let seenOptions: { cacheRetention?: string; apiKey?: string } | undefined;
    const stream = wrapDurableModelStream(async (_actualModel, _actualContext, actualOptions) => {
      seenOptions = actualOptions as { cacheRetention?: string; apiKey?: string } | undefined;
      const source = createAssistantMessageEventStream();
      source.push({ type: 'done', reason: 'toolUse', message: response });
      return source;
    }, async () => async () => {}, () => 'long');

    await (await stream(model, { messages: [] }, { apiKey: 'test-only' })).result();
    expect(seenOptions?.cacheRetention).toBe('long');
    expect(seenOptions?.apiKey).toBe('test-only');
  });

  it('preserves an explicit cacheRetention and skips the default resolver', async () => {
    let resolverCalls = 0;
    let seenOptions: { cacheRetention?: string } | undefined;
    const stream = wrapDurableModelStream(async (_actualModel, _actualContext, actualOptions) => {
      seenOptions = actualOptions as { cacheRetention?: string } | undefined;
      const source = createAssistantMessageEventStream();
      source.push({ type: 'done', reason: 'toolUse', message: response });
      return source;
    }, async () => async () => {}, () => { resolverCalls++; return 'long'; });

    await (await stream(model, { messages: [] }, { cacheRetention: 'none' })).result();
    expect(seenOptions?.cacheRetention).toBe('none');
    expect(resolverCalls).toBe(0);
  });
});

it('cancellation while awaiting T1 commits known zero usage without dispatching', async () => {
  const controller = new AbortController();
  let requests = 0;
  let outcome: AssistantMessage | undefined;
  const stream = wrapDurableModelStream(() => {
    requests++;
    return createAssistantMessageEventStream();
  }, async () => {
    controller.abort();
    return async message => { outcome = message; };
  });
  const result = await (await stream(model, { messages: [] }, { signal: controller.signal })).result();
  expect(requests).toBe(0);
  expect(result.stopReason).toBe('aborted');
  expect(outcome?.usage.cost.total).toBe(0);
});
