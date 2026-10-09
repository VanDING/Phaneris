/** Host-owned persistence; observing a decision never grants authority. */
import { randomUUID } from 'node:crypto';
import { redactSensitiveValues } from '../utils/redaction.ts';
import type { DecisionObservation, DecisionObservationIdentity, DecisionSource, DecisionApplication } from './session.ts';

type Host = (event: DecisionObservation) => boolean;
const hosts = new Set<Host>();
export function registerDecisionObservationHost(host: Host): () => void {
  hosts.add(host);
  return () => { hosts.delete(host); };
}
export function publishDecisionObservation(event: DecisionObservation): void {
  const safe = redactSensitiveValues(event) as DecisionObservation;
  if (safe.kind === 'answered' && safe.record.meta) {
    // Free-form tool metadata can contain the input itself. Keep counters only in session evidence.
    safe.record = { ...safe.record, meta: Object.fromEntries(Object.entries(safe.record.meta).filter(([, value]) => typeof value === 'number' || typeof value === 'boolean')) };
  }
  for (const host of hosts) {
    try { if (host(safe)) return; } catch { /* Persistence cannot alter permission or fallback behaviour. */ }
  }
}
export interface DecisionPointTrace extends DecisionObservationIdentity {
  failed?: boolean;
  source?: DecisionSource;
  apply(application: DecisionApplication): void;
}
export function createDecisionPointTrace(identity: Omit<DecisionObservationIdentity, 'decisionPointId' | 'attemptId'>, source?: DecisionSource): DecisionPointTrace {
  let applied = false;
  const trace: DecisionPointTrace = {
    ...identity, decisionPointId: randomUUID(), source,
    apply(application) {
      if (applied) return;
      applied = true;
      publishDecisionObservation({ ...identity, decisionPointId: trace.decisionPointId, source,
        eventId: `${trace.decisionPointId}:application`, t: Date.now(), kind: 'applied', application });
    },
  };
  publishDecisionObservation({ ...identity, decisionPointId: trace.decisionPointId, source,
    eventId: `${trace.decisionPointId}:started`, t: Date.now(), kind: 'started' });
  return trace;
}
type Payload<T> = T extends unknown ? Omit<T, keyof DecisionObservationIdentity | 'eventId' | 't'> : never;
export function decisionObservation(identity: DecisionObservationIdentity, event: Payload<DecisionObservation>): void {
  const { decisionPointId, sessionId, feature, attemptId } = identity;
  publishDecisionObservation({ decisionPointId, sessionId, feature, attemptId, ...event, eventId: randomUUID(), t: Date.now() } as DecisionObservation);
}
