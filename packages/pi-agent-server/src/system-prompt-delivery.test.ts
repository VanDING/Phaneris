import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, SessionManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type AssistantMessage,
  type Model,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { createPhanerisResourceLoader, getPhanerisSystemPrompt, setPhanerisSystemPrompt } from './phaneris-resource-loader.ts';
import { createPhanerisSettingsManager } from './session-settings.ts';
import { canonicalContextToPiMessages } from './canonical-model-context.ts';

/**
 * Pi SDK 0.86.0 keeps the system prompt in the transcript's system messages and
 * makes `agent.state.systemPrompt` read-only, so Phaneris no longer stamps the
 * SDK's private prompt internals. These tests drive a real session and assert
 * what the provider actually receives.
 */
const model: Model<'openai-responses'> = {
  id: 'test', name: 'test', api: 'openai-responses', provider: 'openai', baseUrl: 'https://invalid.test',
  reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** Prompt text reaches the provider as a string or as text blocks depending on the message source. */
function userText(message: { content?: unknown } | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text').map(part => part.text).join('');
}

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'phaneris-prompt-delivery-'));
  const requests: TranscriptContext[] = [];
  const runtime = {
    hasConfiguredAuth: () => true,
    getModel: () => model,
    getAvailableSnapshot: () => [model],
    streamSimple: (_model: unknown, context: TranscriptContext) => {
      requests.push(context);
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
        stopReason: 'stop', content: [{ type: 'text', text: 'done' }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    },
  } as unknown as ModelRuntime;
  return { dir, requests, runtime };
}

test('delivers the Phaneris prompt as the provider-leading system prompt', async () => {
  const { dir, requests, runtime } = createHarness();
  setPhanerisSystemPrompt('PHANERIS_PROMPT');
  const { session } = await createAgentSession({
    cwd: dir, model, modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: createPhanerisSettingsManager(),
    resourceLoader: await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi') }),
    tools: [],
  });
  try {
    await session.prompt('hello');
    expect(requests).toHaveLength(1);
    expect(getCurrentSystemPrompt(requests[0]!.messages)).toBe('PHANERIS_PROMPT');
    expect(requests[0]!.messages.at(-1)?.role).toBe('user');
    expect(userText(requests[0]!.messages.at(-1))).toBe('hello');
    // The request-time prompt snapshot and the provider request share one source.
    expect(getPhanerisSystemPrompt()).toBe(getCurrentSystemPrompt(requests[0]!.messages));
  } finally {
    session.dispose();
  }
});

test('restores a canonical transcript without losing the prompt', async () => {
  const { dir, requests, runtime } = createHarness();
  setPhanerisSystemPrompt('PHANERIS_PROMPT');
  const { session } = await createAgentSession({
    cwd: dir, model, modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: createPhanerisSettingsManager(),
    resourceLoader: await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi') }),
    tools: [],
  });
  try {
    session.agent.state.messages = canonicalContextToPiMessages({
      cursor: 2,
      items: [
        { kind: 'user', eventId: 'e1', seq: 1, operationId: 'run-1', content: 'committed question' },
        { kind: 'assistant', eventId: 'e2', seq: 2, operationId: 'run-1', content: 'committed answer' },
      ],
    }, model);

    await session.prompt('hello');
    expect(requests).toHaveLength(1);
    expect(getCurrentSystemPrompt(requests[0]!.messages)).toBe('PHANERIS_PROMPT');
    expect(requests[0]!.messages.filter(message => message.role === 'user').map(userText))
      .toEqual(['committed question', 'hello']);
  } finally {
    session.dispose();
  }
});
