import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Model } from '@earendil-works/pi-ai';
import { observeNativeRequest } from './native-request-observation.ts';

const model = { provider: 'test', id: 'test', api: 'openai-responses' } as Model<any>;

describe('native request observation', () => {
  it('hashes the post-extension payload without changing the callback contract or persisting content', async () => {
    const replacement = { input: 'private prompt', reasoning: { effort: 'high' } };
    const { options, observation } = observeNativeRequest({
      apiKey: 'private-key', metadata: { user_id: 'private-user' }, cacheRetention: 'long',
      onPayload: async () => replacement,
    });
    expect(await options.onPayload!({ input: 'original' }, model)).toBe(replacement);
    expect(observation.payloads[0]?.hash).toBe(createHash('sha256').update(JSON.stringify(replacement)).digest('hex'));
    expect(observation.requestedOptions).toEqual({ cacheRetention: 'long' });
    expect(JSON.stringify(observation)).not.toContain('private');
  });

  it('preserves in-place mutation and undefined return values', async () => {
    const payload = { value: 1 };
    const { options, observation } = observeNativeRequest({ onPayload: value => { (value as typeof payload).value = 2; } });
    expect(await options.onPayload!(payload, model)).toBeUndefined();
    expect(payload.value).toBe(2);
    expect(observation.payloads[0]?.hash).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  });

  it('preserves response callbacks and only records allowed headers', async () => {
    let called = 0;
    const { options, observation } = observeNativeRequest({ onResponse: async () => { called++; } });
    await options.onResponse!({ status: 429, headers: {
      'X-Request-ID': 'req-1', 'retry-after': '2', authorization: 'private', 'set-cookie': 'private',
    } }, model);
    expect(called).toBe(1);
    expect(observation.responses[0]).toMatchObject({ status: 429, headers: { 'x-request-id': 'req-1', 'retry-after': '2' } });
    expect(JSON.stringify(observation)).not.toContain('private');
  });

  it('does not turn observation failures into model failures, and bounds observations', async () => {
    const { options, observation } = observeNativeRequest();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await options.onPayload!(circular, model);
    for (let i = 0; i < 40; i++) await options.onPayload!({ i }, model);
    expect(observation.observationErrors).toBe(1);
    expect(observation.payloads).toHaveLength(32);
    expect(observation.payloadCallbackCount).toBe(41);
    expect(observation.droppedObservations).toBe(8);
  });

  it('does not swallow existing callback errors or share observations between concurrent calls', async () => {
    const a = observeNativeRequest({ onPayload: () => { throw new Error('extension failure'); } });
    const b = observeNativeRequest();
    await expect(a.options.onPayload!({}, model)).rejects.toThrow('extension failure');
    await b.options.onPayload!({ b: true }, model);
    expect(a.observation.payloadCallbackCount).toBe(0);
    expect(b.observation.payloadCallbackCount).toBe(1);
  });
});
