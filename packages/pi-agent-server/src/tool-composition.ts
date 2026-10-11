/** A single immutable catalog drives first-turn SDK construction and subsequent activation. */
const UI_HANDOFF_TOOLS = new Set(['SubmitPlan', 'source_oauth_trigger', 'source_google_oauth_trigger',
  'source_slack_oauth_trigger', 'source_microsoft_oauth_trigger', 'source_credential_prompt'])

export function handsControlToUI(name: string): boolean {
  return UI_HANDOFF_TOOLS.has(name.replace(/^(mcp__session__|session__)/, ''))
}

export function composeToolCatalog<Tool extends { name: string; exposure?: string }>(
  groups: readonly (readonly Tool[])[],
  orchestrationNames: readonly string[],
) {
  const customTools = Object.freeze(groups.flatMap(group => [...group]))
  const allowlist = Object.freeze([...customTools.map(tool => tool.name), ...orchestrationNames])
  if (new Set(allowlist).size !== allowlist.length) throw new Error('Duplicate tool in SDK catalog')
  const activeNames = Object.freeze([...customTools.filter(tool => !tool.exposure || tool.exposure === 'direct' || tool.exposure === 'model-only').map(tool => tool.name), ...orchestrationNames])
  return Object.freeze({ customTools, allowlist, activeNames })
}
