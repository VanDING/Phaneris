import type { DecisionRequest, DecisionResult } from './types.ts';

export interface DecisionAccountingScope { sessionId?: string; feature?: string; provider: string; model: string }
export type DecisionAccounting = (request: DecisionRequest, invoke: () => Promise<DecisionResult>) => Promise<DecisionResult>;
type Resolver = (scope: DecisionAccountingScope) => DecisionAccounting | undefined;
const hosts = new Set<Resolver>();

/** Runtime hosts own accounting; shared decisions never reach a workspace database directly. */
export function registerDecisionAccountingHost(resolver: Resolver): () => void {
  hosts.add(resolver);
  return () => { hosts.delete(resolver); };
}
export function resolveDecisionAccounting(scope: DecisionAccountingScope): DecisionAccounting | undefined {
  for (const host of hosts) { const accounting = host(scope); if (accounting) return accounting; }
}
