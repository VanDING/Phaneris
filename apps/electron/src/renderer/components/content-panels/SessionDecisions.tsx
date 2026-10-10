/**
 * Run → Decisions.
 *
 * The two surfaces the Run panel mounts: the Decisions tab itself
 * (`DecisionBoard`) and the one-line summary the Overview tab shows
 * (`DecisionSummary`). Kept as a barrel so `TrajectoryPanel` keeps importing
 * `./SessionDecisions` while the implementation lives in `./session-decisions/`.
 */
export { DecisionBoard as SessionDecisions } from './session-decisions/DecisionBoard'
export { DecisionSummary } from './session-decisions/DecisionSummary'
