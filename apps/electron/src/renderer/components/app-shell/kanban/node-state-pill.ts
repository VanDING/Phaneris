// Renderer-local mapping for per-node run-state pills in the Results panel.
// Kept out of @phaneris/shared (Node-only) — the renderer can't import it.
// Keys are 1:1 with the NodeRunState literals the runner emits
// (packages/shared/src/tasks/storage.ts): pending | running | done | failed | cancelled | skipped.

const NEUTRAL_PILL = 'border-border bg-foreground/[0.06] text-text-secondary'

const NODE_STATE_PILL: Record<string, string> = {
  done: 'border-success/30 bg-success/[0.06] text-success-text',
  failed: 'border-destructive/30 bg-destructive/[0.06] text-destructive-text',
  running: 'border-info/30 bg-info/[0.06] text-info-text',
  // cancelled is a user/system stop, not a failure — keep it neutral so it never reads as red/error.
  cancelled: NEUTRAL_PILL,
  skipped: NEUTRAL_PILL,
  pending: NEUTRAL_PILL,
}

const NODE_STATE_LABEL_KEY: Record<string, string> = {
  done: 'tasks.nodeStateDone',
  failed: 'tasks.nodeStateFailed',
  running: 'tasks.nodeStateRunning',
  cancelled: 'tasks.nodeStateCancelled',
  skipped: 'tasks.nodeStateSkipped',
  pending: 'tasks.nodeStatePending',
}

/**
 * Resolve a node-state string to its pill classes + i18n label key.
 * Unknown/unexpected states fall back to a neutral pill with `labelKey: null`;
 * the caller renders the raw state string as the label in that case.
 */
export function resolveNodeStatePill(state: string): { className: string; labelKey: string | null } {
  return {
    className: NODE_STATE_PILL[state] ?? NEUTRAL_PILL,
    labelKey: NODE_STATE_LABEL_KEY[state] ?? null,
  }
}
