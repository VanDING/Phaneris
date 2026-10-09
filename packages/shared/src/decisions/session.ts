/** Browser-safe contract for session decision evidence. */
import type { DecisionLayerFeature } from './settings.ts';
import type { DecisionRecord, DecisionOutcome, DecisionFollowUp } from './records.ts';

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
  fallback: number;
  unconfirmed: number;
  failures: number;
  cancelled: number;
  knownCostUsd: number;
  knownCostRequests: number;
  unknownCostRequests: number;
  inputTokens: number;
  outputTokens: number;
}
export interface SessionDecisionQuery {
  feature?: DecisionLayerFeature;
  status?: 'changed' | 'fallback' | 'unconfirmed' | 'failed' | 'cancelled';
  turnId?: string;
  cursor?: string;
  limit?: number;
}
export interface SessionDecisionReport {
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
