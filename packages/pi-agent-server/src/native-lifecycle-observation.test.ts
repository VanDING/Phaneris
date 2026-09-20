import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import { createAgentSession, SessionManager, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { createPhanerisResourceLoader } from './phaneris-resource-loader.ts';
import { observeNativeSessionEvent } from './native-lifecycle-observation.ts';
import { wrapDurableModelStream } from './durable-model-stream.ts';

for (const retry of [false, true]) test(`real SDK hooks observe tools and settled usage (retry=${retry}) without mutating execution`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phaneris-native-observation-'));
  const model: Model<'openai-responses'> = {
    id: 'test', name: 'test', api: 'openai-responses', provider: 'openai', baseUrl: 'https://invalid.test',
    reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const observations: Array<{ event: string; data: Record<string, unknown>; sdkSessionId?: string }> = [];
  const observe = (event: string, data: Record<string, unknown>, sdkSessionId?: string) => {
    observations.push({ event, data, sdkSessionId });
  };
  let requests = 0;
  let executions = 0;
  const runtime = {
    hasConfiguredAuth: () => true, getModel: () => model, getAvailableSnapshot: () => [model],
    streamSimple: (_model: unknown, _context: unknown, options: SimpleStreamOptions) => {
      const stream = createAssistantMessageEventStream();
      const index = requests++;
      const failing = retry && index === 0;
      const first = index === (retry ? 1 : 0);
      void (async () => {
        await options.onPayload?.({ input: 'private-input', call: requests }, model);
        await options.onResponse?.({ status: failing ? 429 : 200, headers: { 'x-request-id': `req-${requests}` } }, model);
        const message: AssistantMessage = {
          role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
          stopReason: failing ? 'error' : first ? 'toolUse' : 'stop',
          errorMessage: failing ? '429 rate limit exceeded' : undefined,
          content: failing ? [] : first ? [{ type: 'toolCall', id: 'call-1', name: 'sample', arguments: { value: 'private-argument' } }]
            : [{ type: 'text', text: 'complete' }],
          usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, reasoning: 2, totalTokens: 35,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
        stream.push(failing ? { type: 'error', reason: 'error', error: message }
          : { type: 'done', reason: first ? 'toolUse' : 'stop', message });
      })();
      return stream;
    },
  } as unknown as ModelRuntime;
  const { session } = await createAgentSession({
    cwd: dir, model, modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: retry, maxRetries: 1, baseDelayMs: 1 }, compaction: { enabled: false } }),
    resourceLoader: await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi'), observeLifecycle: observe }),
    tools: ['sample'],
    customTools: [{ name: 'sample', label: 'Sample', description: 'Test tool', parameters: Type.Object({ value: Type.String() }),
      execute: async (_id, args) => {
        expect(args.value).toBe('private-argument');
        executions++;
        return { content: [{ type: 'text', text: 'private-result' }], details: {} };
      } }],
  });
  let commits = 0;
  session.agent.streamFunction = wrapDurableModelStream(session.agent.streamFunction,
    async (_model, _context, evidence) => async () => {
      expect(evidence?.payloadCallbackCount).toBe(1);
      expect(evidence?.responseCallbackCount).toBe(1);
      commits++;
    });
  const unsubscribe = session.subscribe(event => observeNativeSessionEvent(event, session, observe));
  try {
    await session.prompt('Run sample then finish');
    expect(executions).toBe(1);
    expect(commits).toBe(retry ? 3 : 2);
    const events = observations.map(item => item.event);
    expect(events.indexOf('tool_call')).toBeLessThan(events.indexOf('tool_result'));
    expect(events.at(-1)).toBe('agent_settled');
    if (retry) {
      expect(events).toContain('auto_retry_start');
      expect(events).toContain('auto_retry_end');
    }
    const count = retry ? 3 : 2;
    expect(observations.at(-1)?.data).toMatchObject({ scope: 'all_sdk_session_entries', tokens: { input: 10 * count, output: 5 * count, cacheRead: 20 * count, total: 35 * count } });
    expect(observations.every(item => item.sdkSessionId === session.sessionId)).toBe(true);
    expect(JSON.stringify(observations)).not.toContain('private-argument');
    expect(JSON.stringify(observations)).not.toContain('private-result');
  } finally {
    unsubscribe();
    session.dispose();
  }
});
