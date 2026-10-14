/** Facts from one session's retained canonical Runtime ledger, never a quality score. */
export interface RuntimeReliabilityReport {
  schemaVersion: 1;
  state: 'available';
  sessionId: string;
  scope: 'retained-session-runtime-facts';
  asOf: number;
  lastSeq: number;
  terminal: Record<string, number>;
  unsettled: { count: number; toolCount: number; modelCount: number; oldestAgeMs: number | null; operationIds: string[] };
  knownCostUsd: number | null;
  unknownCostRequests: number;
  userAcceptance: 'unknown';
  taskBudgets: Array<{ taskSlug: string; runId: string; limit: number | null; used: number | null }>;
  observations: { pollingCandidates: number; sdkRetries: number; compactions: number; recoveries: number };
  signals: Array<{ kind: 'repeated-action' | 'repeated-error'; toolName: string; count: number; operationIds: string[]; firstSeq: number; lastSeq: number }>;
}
export type ReliabilityObservation = RuntimeReliabilityReport | { state: 'unavailable' };
