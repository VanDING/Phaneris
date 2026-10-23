/**
 * Run → Decisions.
 *
 * The Run panel mounts one decision surface: the ledger bound to the active
 * session. Rendering lives in `@phaneris/ui` (`RunDecisionView`); this barrel
 * keeps the existing `./SessionDecisions` import path for the panel.
 */
export { DecisionBoard as SessionDecisions } from './session-decisions/DecisionBoard'
