/**
 * Steered messages must not be dropped or trickled mid-turn (craft-agents-oss#1040).
 *
 * The SDK drains its steering queue at each model boundary according to
 * `settingsManager.getSteeringMode()`; the default (`one-at-a-time`) releases a
 * single message per boundary, so three steers sent during one turn became three
 * extra model calls and anything still queued when the turn ended could be
 * discarded. `buildPhanerisPiSettings` now pins `steeringMode: 'all'`, and this
 * test drives the real SDK session offline — no provider access — to pin that the
 * installed SDK batches at one boundary and keeps later arrivals for the next.
 *
 * Each model call is awaited through a promise resolved by `streamFunction`
 * itself, so the test never guesses a duration.
 */
import { expect, it } from 'bun:test';
import {
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  type ModelRuntime,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { createPhanerisSettingsManager } from './session-settings.ts';

it('batches steers pending at one model boundary and delivers a later steer at the next', async () => {
  const model: Model<'openai-responses'> = {
    id: 'offline-steering-test', name: 'Offline', api: 'openai-responses', provider: 'openai',
    baseUrl: 'https://invalid.test', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
  };
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => 'Offline steering test', getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {},
  };
  const { session } = await createAgentSession({
    cwd: import.meta.dir, model, settingsManager: createPhanerisSettingsManager(),
    sessionManager: SessionManager.inMemory(import.meta.dir), resourceLoader, tools: [],
    modelRuntime: {
      hasConfiguredAuth: () => true, getModel: () => model, getAvailableSnapshot: () => [model],
      streamSimple: () => { throw new Error('Provider/network access is forbidden'); },
    } as unknown as ModelRuntime,
  });

  // Each entry is the user-message text the model would receive for one call.
  const calls: string[][] = [];
  const releases: (() => void)[] = [];
  const awaiting: (() => void)[] = [];
  /** Register before triggering a call; `streamFunction` resolves it on entry. */
  const nextCall = () => new Promise<void>(resolve => { awaiting.push(resolve); });

  session.agent.streamFunction = (_model, context, options) => {
    calls.push(context.messages.filter(m => m.role === 'user').map(m =>
      typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('')));
    awaiting.shift()?.();
    const stream = createAssistantMessageEventStream();
    let finished = false;
    const finish = (reason: 'stop' | 'aborted' = 'stop') => {
      if (finished) return;
      finished = true;
      const message: AssistantMessage = {
        role: 'assistant', content: [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider,
        model: model.id, timestamp: Date.now(), stopReason: reason,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
      if (reason === 'aborted') stream.push({ type: 'error', reason, error: message });
      else stream.push({ type: 'done', reason, message });
    };
    releases.push(() => finish());
    options?.signal?.addEventListener('abort', () => finish('aborted'), { once: true });
    if (options?.signal?.aborted) finish('aborted');
    return stream;
  };

  const firstCall = nextCall();
  const turn = session.prompt('initial');
  try {
    await firstCall;
    for (const text of ['A', 'B', 'C']) await session.steer(text);
    // The in-flight call is untouched: steering queues, it does not interrupt.
    expect(calls).toHaveLength(1);

    const secondCall = nextCall();
    releases[0]!();
    await secondCall;
    // All three arrive together — not one per boundary, and none dropped.
    expect(calls[1]).toEqual(['initial', 'A', 'B', 'C']);

    const thirdCall = nextCall();
    await session.steer('D');
    expect(calls).toHaveLength(2); // D waits for the next boundary.
    releases[1]!();
    await thirdCall;
    expect(calls[2]).toEqual(['initial', 'A', 'B', 'C', 'D']);

    releases[2]!();
    await turn;
    expect(calls).toHaveLength(3);
  } finally {
    session.clearQueue();
    await session.abort();
    await turn;
    session.dispose();
  }
}, 5000);
