/** Browser-safe contract for session decision evidence. */
import type { DecisionLayerFeature } from './settings.ts';
import type { DecisionRecord, DecisionOutcome, DecisionFollowUp } from './records.ts';
import type { DecisionUsage } from './types.ts';

export interface DecisionSource {
  messageId?: string;
  turnId?: string;
  runOperationId?: string;
  toolCallId?: string;
  taskRunId?: string;
  nodeId?: string;
  automationId?: string;
}
export interface DecisionApplication {
  action: string;
  status: 'applied' | 'unchanged' | 'fallback' | 'discarded' | 'unknown';
  changed: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}
export interface DecisionObservationIdentity {
  decisionPointId: string;
  sessionId?: string;
  feature: DecisionLayerFeature;
  attemptId?: string;
}
export type DecisionObservation = DecisionObservationIdentity & {
  eventId: string;
  t: number;
  source?: DecisionSource;
} & (
  | { kind: 'started' }
  | { kind: 'attempt_started'; provider: string; model: string }
  | { kind: 'sent' }
  | { kind: 'answered'; record: DecisionRecord }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'recommended'; outcome: DecisionOutcome }
  | { kind: 'applied'; application: DecisionApplication }
  | { kind: 'observed'; observation: DecisionFollowUp }
);
export interface SessionDecisionAttempt {
  id: string;
  provider: string;
  model: string;
  sent: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'timeout' | 'unknown';
  record?: DecisionRecord;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costSource?: DecisionUsage['costSource'];
  costField?: DecisionUsage['costField'];
  costUnavailableReason?: DecisionUsage['costUnavailableReason'];
  responseId?: string;
  deadlineMs?: number;
  latencyMs?: number;
  latencyScope?: 'response_body' | 'request_failure';
  accountingOperationId?: string;
}
export interface SessionDecisionItem {
  legacy?: boolean;
  id: string;
  feature: DecisionLayerFeature;
  startedAt: number;
  updatedAt: number;
  source?: DecisionSource;
  attempts: SessionDecisionAttempt[];
  recommendation?: DecisionOutcome;
  application?: DecisionApplication;
  observations: DecisionFollowUp[];
  unavailableReason?: string;
}
export interface SessionDecisionTotals {
  legacyCalls: number;
  points: number;
  requests: number;
  changed: number;
  unchanged: number;
  fallback: number;
  discarded: number;
  unconfirmed: number;
  failures: number;
  cancelled: number;
  knownCostUsd: number;
  knownCostRequests: number;
  unknownCostRequests: number;
  inputTokens: number;
  outputTokens: number;
}
/**
 * The five behavior outcomes the Run view reports, plus request-level states.
 * An outcome answers "what did the caller actually do"; `failed` / `cancelled`
 * answer "did the auxiliary request complete" and are filters, not outcomes.
 */
export type SessionDecisionOutcome = 'changed' | 'unchanged' | 'fallback' | 'discarded' | 'unconfirmed';
export type SessionDecisionStatus = SessionDecisionOutcome | 'failed' | 'cancelled';
export interface SessionDecisionQuery {
  feature?: DecisionLayerFeature;
  status?: SessionDecisionStatus;
  turnId?: string;
  cursor?: string;
  limit?: number;
}
/**
 * The single mapping from one record's evidence to the reported outcome.
 *
 * Application evidence wins: `applied` without a change and `unchanged` both
 * mean behavior stayed the same. A request-level failure is not an outcome — a
 * record whose request failed but that has no application stays unconfirmed,
 * because no caller handling was recorded. An unavailable decision point falls
 * back on the configured path, which is what the host then ran.
 */
export function decisionOutcome(
  item: Pick<SessionDecisionItem, 'application' | 'unavailableReason'>,
): SessionDecisionOutcome {
  const application = item.application;
  if (application) {
    if (application.status === 'applied') return application.changed ? 'changed' : 'unchanged';
    if (application.status === 'unknown') return 'unconfirmed';
    return application.status;
  }
  if (item.unavailableReason) return 'fallback';
  return 'unconfirmed';
}
export interface SessionDecisionReport {
  reliability?: import('../durable-runtime/reliability').ReliabilityObservation;
  schemaVersion: 1;
  sessionId: string;
  workspaceId: string;
  revision: number;
  enabled: boolean;
  coverage: 'recorded' | 'partial';
  recordedFrom?: number;
  totals: SessionDecisionTotals;
  features: Array<{ feature: DecisionLayerFeature; totals: SessionDecisionTotals }>;
  items: SessionDecisionItem[];
  turnIds: string[];
  nextCursor?: string;
}
