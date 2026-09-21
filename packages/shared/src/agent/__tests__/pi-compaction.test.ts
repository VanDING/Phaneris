/**
 * Manual `/compact` RPC path (#1043).
 *
 * The RPC answer — not the SDK's trailing `compaction_end` — owns the turn's
 * occupancy, so the fresh post-compaction estimate reaches the badge and the
 * pre-compaction count is never re-published.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiAgent } from '../pi-agent.ts';
import { AbortReason } from '../core/session-lifecycle.ts';
import type { AgentEvent } from '@phaneris/core/types';

const agents: PiAgent[] = [];

function makeAgent(): PiAgent {
  const agent = new PiAgent({
    provider: 'pi',
    isHeadless: true,
    workspace: {
      id: 'pi-compact-test',
      name: 'Test',
      rootPath: join(tmpdir(), 'pi-compact-test'),
    } as never,
  });
  agents.push(agent);
  // The RPC is exercised directly: no child process is spawned.
  Object.assign(agent, { ensureSubprocess: async () => {} });
  return agent;
}

afterEach(() => { for (const agent of agents.splice(0)) agent.destroy(); });

/** Reach the RPC-only generator; `chat()` would first drain the event queue. */
function startCompact(agent: PiAgent): AsyncGenerator<AgentEvent> {
  return (agent as unknown as { chatImpl(message: string): AsyncGenerator<AgentEvent> }).chatImpl('/compact');
}

type CompactReply = { id: string; success: boolean; result?: unknown; errorMessage?: string };

function interceptCompactSend(agent: PiAgent, onRequest: (msg: { id: string }) => void): void {
  Object.assign(agent, {
    send: (msg: { type?: string; id?: string }) => {
      if (msg.type !== 'compact' || !msg.id) return;
      onRequest({ id: msg.id });
    },
  });
}

async function collect(stream: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const result = {
  summary: 'summary', firstKeptEntryId: 'kept', tokensBefore: 419_000,
  estimatedTokensAfter: 12_000,
  contextUsage: { tokens: null, contextWindow: 500_000 },
  compactionSettings: { enabled: true, reserveTokens: 31_000 },
};

describe('Pi manual compaction RPC', () => {
  it('waits for real completion then emits fresh occupancy, one success, complete', async () => {
    const agent = makeAgent();
    let finish!: () => void;
    const ready = new Promise<void>(resolve => {
      interceptCompactSend(agent, ({ id }) => {
        // The SDK emits its manual end first; the RPC generator owns notification,
        // so that trailing event must not surface a count of its own.
        (agent as unknown as { handleSubprocessEvent(event: unknown): void }).handleSubprocessEvent({
          type: 'compaction_end', reason: 'manual', result, aborted: false, willRetry: false,
        });
        finish = () => (agent as unknown as { handleCompactResult(msg: CompactReply): void })
          .handleCompactResult({ id, success: true, result });
        resolve();
      });
    });

    const events: AgentEvent[] = [];
    const done = (async () => { for await (const e of startCompact(agent)) events.push(e); })();
    await ready;
    expect(events.some(e => e.type === 'info' || e.type === 'context_usage')).toBe(false);

    finish();
    await done;
    expect(events.map(e => e.type)).toEqual(['context_usage', 'info', 'complete']);
    expect(events[0]).toMatchObject({
      type: 'context_usage',
      contextUsage: { usedTokens: 12_000, limitTokens: 469_000, isStale: false },
    });
    expect(events[1]).toMatchObject({ message: expect.stringContaining('419,000') });
  });

  it('fails the turn instead of reporting success when the RPC returns no result', async () => {
    const agent = makeAgent();
    interceptCompactSend(agent, ({ id }) => {
      (agent as unknown as { handleCompactResult(msg: CompactReply): void })
        .handleCompactResult({ id, success: true });
    });

    const events = await collect(startCompact(agent));
    expect(events.at(-1)?.type).toBe('complete');
    expect(events.some(e => e.type === 'info' || e.type === 'context_usage')).toBe(false);
    expect(events.some(e => e.type === 'error' || e.type === 'typed_error')).toBe(true);
  });

  it('reports an RPC error and still completes the turn', async () => {
    const agent = makeAgent();
    interceptCompactSend(agent, ({ id }) => {
      (agent as unknown as { handleCompactResult(msg: CompactReply): void })
        .handleCompactResult({ id, success: false, errorMessage: 'Summary failed' });
    });

    const events = await collect(startCompact(agent));
    expect(events.some(e => e.type === 'error' || e.type === 'typed_error')).toBe(true);
    expect(events.some(e => e.type === 'context_usage')).toBe(false);
    expect(events.at(-1)?.type).toBe('complete');
  });

  it.each(['abort', 'forceAbort', 'destroy'] as const)(
    'cancels the pending manual RPC on %s and ignores its late success',
    async (method) => {
      const agent = makeAgent();
      let requestId!: string;
      let ready!: () => void;
      const sent = new Promise<void>(resolve => { ready = resolve; });
      interceptCompactSend(agent, ({ id }) => { requestId = id; ready(); });

      const done = collect(startCompact(agent));
      await sent;
      if (method === 'forceAbort') agent.forceAbort(AbortReason.UserStop);
      else await agent[method]();

      expect((agent as unknown as { pendingCompactions: Map<string, unknown> }).pendingCompactions.size).toBe(0);
      (agent as unknown as { handleCompactResult(msg: CompactReply): void })
        .handleCompactResult({ id: requestId, success: true, result });

      const events = await done;
      // A cancelled compaction must not publish occupancy or claim success.
      expect(events.some(e => e.type === 'info' || e.type === 'context_usage')).toBe(false);
      expect(events.at(-1)?.type).toBe('complete');
    },
  );
});
