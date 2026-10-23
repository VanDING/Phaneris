/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @phaneris/session-tools-core.
 * Adds the `mcp__session__` prefix that the Pi SDK expects.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@phaneris/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';
import { isDecisionFeatureActive } from '../../../decisions/resolve.ts';
import { getCapabilityPromptSections } from '../../../prompts/system.ts';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

export function getSessionToolProxyDefs(workspaceRootPath?: string): SessionToolProxyDef[] {
  const guidance = getCapabilityPromptSections(workspaceRootPath);
  return getToolDefsAsJsonSchema({
    prefix: 'mcp__session__',
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
    // Same gate as the Claude path (session-scoped-tools.ts): advertise `decide`
    // only while the decision layer is on.
    includeDecide: isDecisionFeatureActive('decideTool'),
  }).map(def => {
    const family = def.namespace?.name.replace('phaneris:', '');
    const ids = family === 'resources' ? ['resources', 'automations'] : family === 'data' ? ['deliverables'] : [family];
    const instructions = guidance.filter(s => ids.includes(s.id)).map(s => s.content).join('');
    return { ...def, ...(def.namespace ? { namespace: { ...def.namespace, ...(instructions ? { instructions } : {}) } } : {}) };
  });
}
