/**
 * Occupancy transport from the Pi subprocess to the host.
 *
 * The SDK owns both numbers (context window and compaction reserve), so the
 * subprocess reports them raw and normalization happens at the host boundary.
 * Reading them is best-effort: a settled turn must not fail because metadata
 * was unavailable.
 */

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { PiContextUsagePayload } from '../../shared/src/agent/backend/pi/protocol.ts';

type ContextSession = Pick<AgentSession, 'getContextUsage' | 'settingsManager'>;

/** Capture SDK-owned values synchronously at a boundary, never billable lastUsage. */
export function readContextUsage(session: ContextSession): PiContextUsagePayload {
  // Metadata must not break a completed model turn/compaction if unavailable.
  let contextUsage: PiContextUsagePayload['contextUsage'];
  let compactionSettings: PiContextUsagePayload['compactionSettings'];
  try {
    contextUsage = session.getContextUsage();
  } catch { /* fail soft: no invented count */ }
  try {
    const { enabled, reserveTokens } = session.settingsManager.getCompactionSettings();
    compactionSettings = { enabled, reserveTokens };
  } catch { /* fail soft: no guessed SDK reserve */ }
  return {
    ...(contextUsage && { contextUsage }),
    ...(compactionSettings && { compactionSettings }),
  };
}

/** message_end listeners run before SDK journal append; read after it commits. */
export function deferContextUsage<T extends ContextSession>(
  session: T,
  getCurrentSession: () => T | null,
  emit: (payload: PiContextUsagePayload) => void,
): void {
  queueMicrotask(() => {
    if (getCurrentSession() !== session) return;
    emit(readContextUsage(session));
  });
}
