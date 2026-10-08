/**
 * Decision layer — usage summary over `decisions.jsonl`.
 *
 * Joins decision lines with their outcome and follow-up lines (`decisionId` → `id`)
 * and reports, per feature: calls, failures, latency, tokens, how often an answer
 * came back with an outcome and how often it changed behaviour (the number
 * that says whether a toggle earns its keep), the action counts and the
 * follow-up results (e.g. whether a suggested source was then used).
 * Records written before outcomes existed have no `id`; they count as calls
 * without an outcome.
 */

import { readFile } from 'node:fs/promises';
import type { DecisionLayerFeature } from './settings.ts';
import {
  defaultDecisionsLogPath,
  previousDecisionsLogPath,
  isDecisionFollowUpRecord,
  isDecisionOutcomeRecord,
  type DecisionFollowUpRecord,
  type DecisionLogLine,
  type DecisionOutcomeRecord,
  type DecisionRecord,
} from './records.ts';

export interface DecisionUsageFilter {
  sessionId?: string;
  /** Only lines at or after this time. */
  since?: Date;
  feature?: string;
  /** Only these providers (e.g. to leave out test stubs written before test isolation). */
  providers?: string[];
}

export interface FeatureUsage {
  feature: string;
  calls: number;
  failures: number;
  cancelled: number;
  coldCalls: number;
  coldFailures: number;
  knownCostUsd: number;
  unknownCostCalls: number;
  /** Failure kind → count. */
  failureKinds: Record<string, number>;
  /** Calls whose outcome was recorded. */
  withOutcome: number;
  /** Outcomes with `changed: true`. */
  changed: number;
  /** Action → count. */
  actions: Record<string, number>;
  /** Follow-up result → count (a decision can have several). */
  followUps: Record<string, number>;
  followUpsByAction: Record<string, Record<string, number>>;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

export interface DecisionUsageSummary {
  total: number;
  failures: number;
  providers: Record<string, number>;
  features: FeatureUsage[];
}

/** Parse a decisions.jsonl body; malformed lines are skipped. */
export function parseDecisionLog(text: string): DecisionLogLine[] {
  const lines: DecisionLogLine[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const line: unknown = JSON.parse(raw);
      if (!line || typeof line !== 'object' || Array.isArray(line)) continue;
      const value = line as Record<string, unknown>;
      if (typeof value.t !== 'string' || typeof value.feature !== 'string') continue;
      if (value.kind === 'outcome') {
        if (typeof value.decisionId !== 'string' || typeof value.action !== 'string' || typeof value.changed !== 'boolean') continue;
      } else if (value.kind === 'followup') {
        if (typeof value.decisionId !== 'string' || typeof value.result !== 'string') continue;
      } else if (value.kind !== undefined || typeof value.provider !== 'string' || typeof value.ok !== 'boolean') {
        continue;
      }
      lines.push(line as DecisionLogLine);
    } catch {
      // A torn last line from a crash; ignore it.
    }
  }
  return lines;
}

/** Read and parse a log; `[]` when it does not exist. */
export async function readDecisionLog(path: string): Promise<DecisionLogLine[]> {
  try {
    return parseDecisionLog(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarizeDecisionUsage(lines: readonly DecisionLogLine[], filter: DecisionUsageFilter = {}): DecisionUsageSummary {
  const since = filter.since?.getTime();
  const keep = (line: { t: string; sessionId?: string; feature: string }) =>
    (!filter.sessionId || line.sessionId === filter.sessionId)
    && (!filter.feature || line.feature === filter.feature)
    && (since === undefined || Date.parse(line.t) >= since);

  const outcomes = new Map<string, DecisionOutcomeRecord>();
  const followUps = new Map<string, DecisionFollowUpRecord[]>();
  const decisions: DecisionRecord[] = [];
  const seenDecisions = new Set<string>();
  const seenFollowUps = new Set<string>();
  for (const line of lines) {
    if (isDecisionOutcomeRecord(line)) outcomes.set(line.decisionId, line);
    else if (isDecisionFollowUpRecord(line)) {
      const key = JSON.stringify(line);
      if (!seenFollowUps.has(key)) followUps.set(line.decisionId, [...(followUps.get(line.decisionId) ?? []), line]);
      seenFollowUps.add(key);
    } else if (keep(line) && (!filter.providers || filter.providers.includes(line.provider)) && (!line.id || !seenDecisions.has(line.id))) {
      decisions.push(line);
      if (line.id) seenDecisions.add(line.id);
    }
  }

  const byFeature = new Map<string, { usage: FeatureUsage; latencies: number[]; sessions: Set<string> }>();
  const providers: Record<string, number> = Object.create(null);
  let failures = 0;
  for (const record of decisions) {
    providers[record.provider] = (providers[record.provider] ?? 0) + 1;
    let entry = byFeature.get(record.feature);
    if (!entry) {
      entry = {
        usage: { feature: record.feature, calls: 0, failures: 0, cancelled: 0, coldCalls: 0, coldFailures: 0, knownCostUsd: 0, unknownCostCalls: 0, failureKinds: Object.create(null), withOutcome: 0, changed: 0, actions: Object.create(null), followUps: Object.create(null), followUpsByAction: Object.create(null), inputTokens: 0, outputTokens: 0, sessions: 0 },
        latencies: [],
        sessions: new Set(),
      };
      byFeature.set(record.feature, entry);
    }
    const { usage } = entry;
    usage.calls++;
    if (record.sessionId) entry.sessions.add(record.sessionId);
    if (typeof record.latencyMs === 'number') entry.latencies.push(record.latencyMs);
    usage.inputTokens += record.usage?.inputTokens ?? 0;
    usage.outputTokens += record.usage?.outputTokens ?? 0;
    const cost = record.usage?.costUsd;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) usage.unknownCostCalls++;
    else usage.knownCostUsd += cost;
    if (record.error?.kind === 'cancelled') usage.cancelled++;
    if (record.coldStart) usage.coldCalls++;
    if (!record.ok) {
      if (record.coldStart) usage.coldFailures++;
      usage.failures++;
      failures++;
      const kind = record.error?.kind ?? 'unknown';
      usage.failureKinds[kind] = (usage.failureKinds[kind] ?? 0) + 1;
      continue;
    }
    const outcome = record.id ? outcomes.get(record.id) : undefined;
    for (const followUp of (record.id ? followUps.get(record.id) : undefined) ?? []) {
      usage.followUps[followUp.result] = (usage.followUps[followUp.result] ?? 0) + 1;
      const byAction = (usage.followUpsByAction[outcome?.action ?? '-'] ??= Object.create(null));
      byAction[followUp.result] = (byAction[followUp.result] ?? 0) + 1;
    }
    if (!outcome) continue;
    usage.withOutcome++;
    if (outcome.changed) usage.changed++;
    usage.actions[outcome.action] = (usage.actions[outcome.action] ?? 0) + 1;
  }

  const features = [...byFeature.values()]
    .map(({ usage, latencies, sessions }) => {
      latencies.sort((a, b) => a - b);
      return { ...usage, sessions: sessions.size, latencyP50Ms: percentile(latencies, 50), latencyP95Ms: percentile(latencies, 95) };
    })
    .sort((a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature));

  return { total: decisions.length, failures, providers, features };
}

export const DECISION_RECORD_TAGS: Record<DecisionLayerFeature, string> = {
  decideTool: 'decide_tool', taskVerdicts: 'task_verdict', semanticLabels: 'semantic_labels', turnOutcome: 'turn_outcome',
  guardedMode: 'guarded_mode', riskBadges: 'risk_badges', automationConditions: 'automation_condition', taskRepairs: 'task_repairs',
  smartTitles: 'smart_titles', adaptiveThinking: 'adaptive_thinking', midTurnMessages: 'mid_turn_messages', largeResults: 'large_results', suggestions: 'suggestions',
};

export interface DecisionUsageReport {
  since: string;
  retainedFrom?: string;
  /** Logs are bounded; absence of older records does not prove zero earlier usage. */
  retentionLimited: boolean;
  features: Partial<Record<DecisionLayerFeature, FeatureUsage>>;
}

export async function readDecisionUsageReport(since: Date, logPath: string = defaultDecisionsLogPath()): Promise<DecisionUsageReport> {
  const [previous, current] = await Promise.all([readDecisionLog(previousDecisionsLogPath(logPath)), readDecisionLog(logPath)]);
  const lines = [...previous, ...current];
  const byTag = new Map(summarizeDecisionUsage(lines, { since }).features.map(feature => [feature.feature, feature]));
  const features: DecisionUsageReport['features'] = {};
  for (const [toggle, tag] of Object.entries(DECISION_RECORD_TAGS) as [DecisionLayerFeature, string][]) {
    const feature = byTag.get(tag);
    if (feature) features[toggle] = feature;
  }
  const times = lines.map(line => Date.parse(line.t)).filter(Number.isFinite);
  const retained = times.length ? times.reduce((oldest, time) => Math.min(oldest, time), Infinity) : undefined;
  return { since: since.toISOString(), ...(retained !== undefined ? { retainedFrom: new Date(retained).toISOString() } : {}), retentionLimited: retained === undefined || retained > since.getTime(), features };
}

/** Plain-text table for terminals. */
export function formatDecisionUsage(summary: DecisionUsageSummary): string {
  if (summary.total === 0) return 'No decision records match.';
  const providers = Object.entries(summary.providers).map(([name, count]) => `${name} ${count}`).join(', ');
  const rows = summary.features.map(f => [
    f.feature,
    String(f.calls),
    String(f.failures),
    String(f.cancelled),
    f.coldCalls > 0 ? `${f.coldFailures}/${f.coldCalls}` : '-',
    `${f.knownCostUsd.toFixed(6)} + ${f.unknownCostCalls} unknown`,
    f.withOutcome > 0 ? `${f.changed}/${f.withOutcome}` : '-',
    f.latencyP50Ms !== undefined ? `${f.latencyP50Ms}/${f.latencyP95Ms}` : '-',
    String(f.sessions),
    Object.entries(f.actions).sort((a, b) => b[1] - a[1]).map(([action, count]) => `${action}×${count}`).join(' ') || '-',
  ]);
  const header = ['feature', 'calls', 'failed', 'cancelled', 'cold failed', 'cost USD', 'changed', 'p50/p95 ms', 'sessions', 'actions'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join('  ');
  const followUps = summary.features
    .filter(f => Object.keys(f.followUps).length > 0)
    .flatMap(f => Object.entries(f.followUpsByAction).map(([action, results]) =>
      `${f.feature} [${action}]: ${Object.entries(results).sort((a, b) => b[1] - a[1]).map(([result, count]) => `${result}×${count}`).join(' ')}`));
  return [
    `${summary.total} decisions (${summary.failures} failed) — ${providers}`, '', line(header), ...rows.map(line),
    ...(followUps.length > 0 ? ['', 'follow-ups', ...followUps] : []),
  ].join('\n');
}
