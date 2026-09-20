import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import { createAgentSession, SessionManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { installCacheWarmingAccounting } from './cache-warming-accounting.ts';
import { wrapDurableModelStream } from './durable-model-stream.ts';
import { createPhanerisResourceLoader } from './phaneris-resource-loader.ts';
import { createPhanerisSettingsManager } from './session-settings.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const [enabled, supported, inFlight] of [[false, true, false], [true, true, false], [true, false, false], [true, true, true]] as const) test(`real SDK accounts warming separately and stops on disable/settle (enabled=${enabled}, supported=${supported}, inFlight=${inFlight})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phaneris-cache-warm-'));
  // A synthetic 10.02-second TTL schedules at TTL - 10 seconds = 20ms.
  const model = {
    id: 'test', name: 'test', api: 'openai-responses' as const, provider: 'test', baseUrl: 'https://invalid.test',
    reasoning: false, input: ['text' as const], contextWindow: 200000, maxTokens: 4096,
    cost: { input: 10, output: 1, cacheRead: 1, cacheWrite: 12 }, promptCache: supported ? { short: 10.02 } : undefined,
  };
  let ordinaryCalls = 0;
  let warmCalls = 0;
  let ordinaryCommits = 0;
  let warmCommits = 0;
  let releaseTool!: () => void;
  const toolWait = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const toolReady = new Promise<void>(resolve => { toolStarted = resolve; });
  let warmStarted!: () => void;
  const warmStartedPromise = new Promise<void>(resolve => { warmStarted = resolve; });
  let warmCompleted!: () => void;
  const warmReady = new Promise<void>(resolve => { warmCompleted = resolve; });
  const runtime = {
    hasConfiguredAuth: () => true, getModel: () => model, getAvailableSnapshot: () => [model],
    streamSimple: (_model: unknown, _context: unknown, options: SimpleStreamOptions) => {
      const warming = options.maxTokens === 1 && options.maxRetries === 0;
      if (warming) warmCalls++; else ordinaryCalls++;
      const first = !warming && ordinaryCalls === 1;
      const message: AssistantMessage = {
        role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
        stopReason: first ? 'toolUse' : 'stop',
        content: first ? [{ type: 'toolCall', id: 'call-1', name: 'wait', arguments: {} }]
          : [{ type: 'text', text: warming ? 'discard this warm response' : 'done' }],
        usage: { input: 0, output: 1, cacheRead: 100000, cacheWrite: 0, totalTokens: 100001,
          cost: { input: 0, output: 0.000001, cacheRead: 0.1, cacheWrite: 0, total: 0.100001 } },
      };
      const stream = createAssistantMessageEventStream();
      if (warming && inFlight) {
        options.signal!.addEventListener('abort', () => {
          stream.push({ type: 'error', reason: 'aborted', error: { ...message, stopReason: 'aborted' } });
        }, { once: true });
        warmStarted();
      } else {
        stream.push({ type: 'done', reason: first ? 'toolUse' : 'stop', message });
      }
      return stream;
    },
  } as unknown as ModelRuntime;
  const { session } = await createAgentSession({
    cwd: dir, model, modelRuntime: runtime, sessionManager: SessionManager.inMemory(dir),
    settingsManager: createPhanerisSettingsManager(),
    resourceLoader: await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi') }),
    tools: ['wait'], customTools: [{ name: 'wait', label: 'Wait', description: 'Wait for work', parameters: Type.Object({}),
      execute: async () => { toolStarted(); await toolWait; return { content: [{ type: 'text', text: 'ready' }], details: {} }; } }],
  });
  session.agent.streamFunction = wrapDurableModelStream(installCacheWarmingAccounting(
    runtime, session.agent.streamFunction,
    stream => wrapDurableModelStream(stream, async () => async message => {
      expect(message.usage.cacheRead).toBe(100000);
      warmCommits++;
      warmCompleted();
    }),
  ), async () => async () => { ordinaryCommits++; });
  session.setCacheWarmingMode(enabled ? 'streaming' : 'off');
  let prompt: Promise<void> | undefined;
  try {
    prompt = session.prompt('Run wait then finish');
    await toolReady;
    if (enabled && supported) {
      if (inFlight) {
        await Promise.race([warmStartedPromise, delay(2000).then(() => { throw new Error('No refresh started'); })]);
        session.setCacheWarmingMode('off');
      }
      await Promise.race([warmReady, delay(2000).then(() => { throw new Error('SDK did not route warming'); })]);
      session.setCacheWarmingMode('off');
      const count = warmCalls;
      await delay(65);
      expect(warmCalls).toBe(count);
      // Turning on during an existing tool run applies on the next real request.
      session.setCacheWarmingMode('streaming');
    } else {
      await delay(65);
      expect(warmCalls).toBe(0);
    }
    releaseTool();
    await prompt;
    const count = warmCalls;
    await delay(65);
    expect(warmCalls).toBe(count);
    expect(ordinaryCalls).toBe(2);
    expect(ordinaryCommits).toBe(ordinaryCalls);
    expect(warmCommits).toBe(warmCalls);
    expect(session.cacheWarmingStatus?.state).toBe('inactive');
    expect(JSON.stringify(session.messages)).not.toContain('discard this warm response');
  } finally {
    releaseTool();
    await prompt;
    session.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ordinary one-token request is never counted as a background refresh', async () => {
  let warming = 0;
  const runtime = { streamSimple: () => createAssistantMessageEventStream() } as unknown as ModelRuntime;
  const sessionStream = installCacheWarmingAccounting(runtime,
    (model, context, options) => runtime.streamSimple(model, context, options),
    stream => { return (...args) => { warming++; return stream(...args); }; });
  await sessionStream({} as never, { messages: [] }, { maxTokens: 1, maxRetries: 0 });
  expect(warming).toBe(0);
});
