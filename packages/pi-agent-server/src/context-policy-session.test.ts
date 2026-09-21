/**
 * Context handoff at the real SDK boundary.
 *
 * The unit tests drive the wrapper directly. This one proves the wiring: the SDK
 * hands it a real `TranscriptContext`, the document request it synthesizes is
 * accepted by the SDK's own transcript handling, and the turn ends with the
 * handoff reported — instead of the ordinary answer the provider would have given.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import { createAgentSession, SessionManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { createContextPolicyStream, type HandoffSignal } from './context-policy-stream.ts';
import { createPhanerisResourceLoader } from './phaneris-resource-loader.ts';
import { createPhanerisSettingsManager } from './session-settings.ts';

const DOCUMENT = [
  '# Goal', 'Finish the context policy work.', '',
  '# Completed', 'Wired the SDK compaction toggle.', '',
  '# State', 'packages/shared/src/agent/context-policy.ts is modified.', '',
  '# Next', 'Continue the wrapper tests.', '',
  '# References', 'packages/pi-agent-server/src/context-policy-stream.ts',
].join('\n');

test('a real session replaces the overflowing request with document generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phaneris-handoff-'));
  const requested: Array<{ messages: TranscriptContext['messages']; options?: SimpleStreamOptions }> = [];
  const signals: HandoffSignal[] = [];
  let policy: 'compact' | 'handoff' = 'handoff';

  // The window and the reported usage are chosen so the first committed turn
  // lands inside the band where a handoff both triggers and still fits.
  const model = {
    id: 'test', name: 'test', api: 'anthropic-messages' as const, provider: 'test', baseUrl: 'https://invalid.test',
    reasoning: false, input: ['text' as const], contextWindow: 128_000, maxTokens: 16_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  };

  const runtime = {
    hasConfiguredAuth: () => true,
    getModel: () => model,
    getAvailableSnapshot: () => [model],
    streamSimple: (_model: typeof model, context: TranscriptContext, options: SimpleStreamOptions) => {
      const isDocumentRequest = getCurrentTools(context.messages).length === 0;
      requested.push({ messages: context.messages, options });
      // The first ordinary request reports usage that fills the window, so the
      // very next request is the one that must be intercepted.
      const text = isDocumentRequest ? DOCUMENT : 'ordinary answer';
      const message: AssistantMessage = {
        role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
        stopReason: 'stop', content: [{ type: 'text', text }],
        usage: {
          input: isDocumentRequest ? 0 : 110_000, output: 0, cacheRead: 0, cacheWrite: 0,
          totalTokens: isDocumentRequest ? 100 : 110_000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    },
  } as unknown as ModelRuntime;

  const { session } = await createAgentSession({
    cwd: dir, model, modelRuntime: runtime, sessionManager: SessionManager.inMemory(dir),
    settingsManager: createPhanerisSettingsManager(),
    resourceLoader: await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi') }),
    tools: ['wait'],
    customTools: [{
      name: 'wait', label: 'Wait', description: 'Wait for work', parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'ready' }], details: {} }),
    }],
  });
  session.setAutoCompactionEnabled(false);
  session.agent.streamFunction = createContextPolicyStream(
    session.agent.streamFunction,
    () => policy,
    signal => signals.push(signal),
    () => false,
  );

  try {
    await session.prompt('Start the task');
    await session.prompt('Continue the task');

    // The overflow request never reached the provider: the second call is the
    // document request, with tools withdrawn and its own output budget.
    expect(requested).toHaveLength(2);
    expect(requested[0]!.messages.some(message => message.role === 'toolResult')).toBe(false);
    const documentRequest = requested[1]!;
    expect(getCurrentTools(documentRequest.messages)).toHaveLength(0);
    // The reserved document budget, not the model's 16K default.
    expect(documentRequest.options?.maxTokens).toBe(8192);
    expect(String(documentRequest.messages.at(-1)!.content)).toContain('handoff document');

    expect(signals.map(signal => signal.phase)).toEqual(['generating', 'ready']);
    expect(signals[1]!.document).toBe(DOCUMENT);

    policy = 'compact';
  } finally {
    session.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compact policy leaves the SDK request path untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phaneris-handoff-compact-'));
  const requested: string[] = [];
  const signals: HandoffSignal[] = [];
  const model = {
    id: 'test', name: 'test', api: 'anthropic-messages' as const, provider: 'test', baseUrl: 'https://invalid.test',
    reasoning: false, input: ['text' as const], contextWindow: 128_000, maxTokens: 16_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  };
  const runtime = {
    hasConfiguredAuth: () => true,
    getModel: () => model,
    getAvailableSnapshot: () => [model],
    streamSimple: (_model: unknown, context: TranscriptContext) => {
      requested.push(JSON.stringify(context.messages.at(-1)!.content));
      const message: AssistantMessage = {
        role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
        stopReason: 'stop', content: [{ type: 'text', text: 'ordinary answer' }],
        usage: { input: 110_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 110_000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    },
  } as unknown as ModelRuntime;

  const { session } = await createAgentSession({
    cwd: dir, model, modelRuntime: runtime, sessionManager: SessionManager.inMemory(dir),
    settingsManager: createPhanerisSettingsManager(),
    resourceLoader: await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi') }),
    tools: [],
  });
  session.setAutoCompactionEnabled(true);
  session.agent.streamFunction = createContextPolicyStream(
    session.agent.streamFunction,
    () => 'compact',
    signal => signals.push(signal),
    () => false,
  );

  try {
    await session.prompt('Start the task');
    await session.prompt('Continue the task');
    expect(requested.every(entry => !entry.includes('handoff document'))).toBe(true);
    expect(signals).toEqual([]);
  } finally {
    session.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
