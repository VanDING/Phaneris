/**
 * Documentation links and summaries for contextual help throughout the UI.
 * Summaries provide quick context; "Learn more" opens the full guide.
 *
 * `slug` addresses a page in the app's own bundled documentation, which lives at
 * `apps/electron/src/renderer/docs/guide/<locale>/<slug>.md`. It is deliberately
 * NOT a URL: the renderer opens the docs overlay with this slug, and the Web UI
 * cannot follow `phaneris://` links at all, so anything URL-shaped here would
 * either reach the network or silently do nothing in browser mode.
 *
 * The slugs mirror the path shape the upstream docs site used for the same
 * topic, which keeps the mapping obvious and means the pages an external deep
 * link names are the pages the in-app help menu opens.
 *
 * `doc-links.test.ts` (renderer) asserts every slug here resolves to a real
 * manifest page — a typo would otherwise surface as an empty "not written yet"
 * pane rather than as a failure.
 */

export type DocFeature =
  | 'sources'
  | 'sources-api'
  | 'sources-mcp'
  | 'sources-local'
  | 'skills'
  | 'statuses'
  | 'permissions'
  | 'labels'
  | 'workspaces'
  | 'themes'
  | 'app-settings'
  | 'preferences'
  | 'automations'
  | 'messaging'

export interface DocInfo {
  /** Page slug within the bundled documentation. */
  slug: string
  /** Display title for the help popover */
  title: string
  /** 1-2 sentence summary for quick context */
  summary: string
}

export const DOCS: Record<DocFeature, DocInfo> = {
  sources: {
    slug: 'sources/overview',
    title: 'Sources',
    summary:
      'Connect external data like MCP servers, REST APIs, and local filesystems. Sources give your agent tools to access services like GitHub, Linear, or your Obsidian vault.',
  },
  'sources-api': {
    slug: 'sources/apis',
    title: 'APIs',
    summary:
      'Connect to any REST API with flexible authentication. Make HTTP requests to external services directly from your conversations.',
  },
  'sources-mcp': {
    slug: 'sources/mcp-servers',
    title: 'MCP Servers',
    summary:
      'Connect to Model Context Protocol servers for rich tool integrations. MCP servers provide structured access to services like GitHub, Linear, and Notion.',
  },
  'sources-local': {
    slug: 'sources/local-filesystems',
    title: 'Local Folders',
    summary:
      'Give your agent access to local directories like Obsidian vaults, code repositories, or data folders on your machine.',
  },
  skills: {
    slug: 'skills/overview',
    title: 'Skills',
    summary:
      'Reusable instruction sets that teach your agent specialized behaviors. Create a SKILL.md file and invoke it with @mention in your messages.',
  },
  statuses: {
    slug: 'statuses/overview',
    title: 'Statuses',
    summary:
      'Organize conversations into workflow states like Todo, In Progress, and Done. Open statuses appear in your inbox; closed ones move to the archive.',
  },
  permissions: {
    slug: 'core-concepts/permissions',
    title: 'Permissions',
    summary:
      'Control how much autonomy your agent has. Explore mode is read-only, Ask to Edit prompts before changes, and Execute mode runs without prompts.',
  },
  labels: {
    slug: 'labels/overview',
    title: 'Labels',
    summary:
      'Tag sessions with colored labels for organization and filtering. Labels support hierarchical nesting, typed values, and auto-apply rules that extract data from messages using regex patterns.',
  },
  workspaces: {
    slug: 'go-further/workspaces',
    title: 'Workspaces',
    summary:
      'Separate configurations for different contexts like personal projects or work. Each workspace has its own sources, skills, statuses, and session history.',
  },
  themes: {
    slug: 'customisation/themes',
    title: 'Themes',
    summary:
      'Customize the complete visual style with semantic colors, depth, shape, typography, icons, and density tokens defined in theme JSON files.',
  },
  'app-settings': {
    slug: 'reference/config-file',
    title: 'App Settings',
    summary:
      'Configure global app settings like your default model, authentication method, and workspace list. Settings are stored in ~/.phaneris/config.json.',
  },
  preferences: {
    slug: 'reference/preferences',
    title: 'Preferences',
    summary:
      'Personal preferences like your name, timezone, and language that help the agent personalize responses. Stored in ~/.phaneris/preferences.json.',
  },
  automations: {
    slug: 'automations/overview',
    title: 'Automations',
    summary:
      'Automate actions when events occur — run commands on schedules, react to label changes, or trigger prompts. Configured in automations.json.',
  },
  messaging: {
    slug: 'messaging/overview',
    title: 'Messaging',
    summary:
      'Connect a session to a chat platform — Telegram, WhatsApp, Lark / Feishu, WeChat, or WeCom — and reach your agent from anywhere. Pair workspace supergroups, route automations to forum topics, and send rich replies natively.',
  },
}

/**
 * Get the documentation page slug for a feature.
 *
 * Callers open the docs overlay with this value; they must not treat it as a URL.
 */
export function getDocSlug(feature: DocFeature): string {
  return DOCS[feature].slug
}

/**
 * Get the doc info (title, summary, slug) for a feature
 */
export function getDocInfo(feature: DocFeature): DocInfo {
  return DOCS[feature]
}
