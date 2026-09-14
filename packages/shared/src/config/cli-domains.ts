import { CLI_NAME } from '../identity.generated.ts'

export type CliDomainNamespace = 'label' | 'source' | 'skill' | 'automation' | 'permission' | 'theme'

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  label: {
    namespace: 'label',
    helpCommand: 'phaneris label --help',
    workspacePathScopes: ['labels/**'],
    readActions: ['list', 'get', 'auto-rule-list', 'auto-rule-validate'],
    quickExamples: [
      'phaneris label list',
      'phaneris label create --name "Bug" --color "accent"',
      'phaneris label update bug --json \'{"name":"Bug Report"}\'',
    ],
    bashGuardPaths: ['labels/**'],
  },
  source: {
    namespace: 'source',
    helpCommand: 'phaneris source --help',
    workspacePathScopes: ['sources/**'],
    readActions: ['list', 'get', 'validate', 'test', 'auth-help'],
    quickExamples: [
      'phaneris source list',
      'phaneris source get <slug>',
      'phaneris source update <slug> --json "{...}"',
      'phaneris source validate <slug>',
    ],
  },
  skill: {
    namespace: 'skill',
    helpCommand: 'phaneris skill --help',
    workspacePathScopes: ['skills/**'],
    readActions: ['list', 'get', 'validate', 'where'],
    quickExamples: [
      'phaneris skill list',
      'phaneris skill get <slug>',
      'phaneris skill update <slug> --json "{...}"',
      'phaneris skill validate <slug>',
    ],
  },
  automation: {
    namespace: 'automation',
    helpCommand: 'phaneris automation --help',
    workspacePathScopes: ['automations.json', 'automations-history.jsonl'],
    readActions: ['list', 'get', 'validate', 'history', 'last-executed', 'test', 'lint'],
    quickExamples: [
      'phaneris automation list',
      'phaneris automation create --event UserPromptSubmit --prompt "Summarize this prompt"',
      'phaneris automation update <id> --json "{\"enabled\":false}"',
      'phaneris automation history <id> --limit 20',
      'phaneris automation validate',
    ],
    bashGuardPaths: ['automations.json', 'automations-history.jsonl'],
  },
  permission: {
    namespace: 'permission',
    helpCommand: 'phaneris permission --help',
    workspacePathScopes: ['permissions.json', 'sources/*/permissions.json'],
    readActions: ['list', 'get', 'validate'],
    quickExamples: [
      'phaneris permission list',
      'phaneris permission get --source linear',
      'phaneris permission add-mcp-pattern "list" --comment "All list ops" --source linear',
      'phaneris permission validate',
    ],
    bashGuardPaths: ['permissions.json', 'sources/*/permissions.json'],
  },
  theme: {
    namespace: 'theme',
    helpCommand: 'phaneris theme --help',
    workspacePathScopes: ['config.json'],
    readActions: ['get', 'validate', 'list-presets', 'get-preset'],
    quickExamples: [
      'phaneris theme get',
      'phaneris theme list-presets',
      'phaneris theme set-color-theme nord',
      'phaneris theme set-workspace-color-theme default',
    ],
    bashGuardPaths: ['config.json'],
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by phaneris CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const PHANERIS_AGENTS_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const PHANERIS_AGENTS_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for phaneris CLI owned paths.
 */
export const PHANERIS_AGENTS_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const PHANERIS_AGENTS_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only phaneris bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getPhanerisReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]
  const namespaceAlternation = namespaces.join('|')

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    return {
      pattern: `^${CLI_NAME}\\s+${namespace}\\s+(${actions})\\b`,
      comment: `phaneris ${namespace} read-only operations`,
    }
  })

  rules.push(
    { pattern: `^${CLI_NAME}\\s*$`, comment: `${CLI_NAME} bare invocation (prints help)` },
    { pattern: `^${CLI_NAME}\\s+(${namespaceAlternation})\\s*$`, comment: `${CLI_NAME} entity help` },
    { pattern: `^${CLI_NAME}\\s+(${namespaceAlternation})\\s+--help\\b`, comment: `${CLI_NAME} entity help flags` },
    { pattern: `^${CLI_NAME}\\s+--(help|version|discover)\\b`, comment: `${CLI_NAME} global flags` },
  )

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
