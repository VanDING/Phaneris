/**
 * Documentation manifest — the navigation's single source of truth.
 *
 * Pure data with no Vite-specific imports, so `manifest.test.ts` can assert the
 * invariants in a plain bun run: unique slugs, at most one `home`, and a
 * content file on disk for every page in every shipped locale.
 *
 * Page content lives at `./guide/<locale>/<slug>.md` and is compiled into the
 * renderer bundle (see `content.ts`). Nothing here reads the filesystem at
 * runtime.
 *
 * Slugs deliberately mirror the shape the upstream docs site uses for the same
 * topic (`sources/overview`, `go-further/workspaces`, ...). That keeps the
 * mapping from `DocFeature` to page in `@phaneris/shared/docs/doc-links`
 * obvious, and it means the pages the in-app help links point at are the same
 * pages an external deep link names.
 */

/** Locales with a `guide/<locale>/` directory. English is authored first. */
export const DOCS_LOCALES = ['en'] as const

export type DocsLocale = (typeof DOCS_LOCALES)[number]

/**
 * Fallback locale. A page missing from a translated locale renders this one
 * rather than an empty pane, so a partial translation degrades to English
 * instead of to nothing.
 */
export const DEFAULT_DOCS_LOCALE: DocsLocale = 'en'

export interface DocsPage {
  /** Path-shaped identifier, unique across the manifest. */
  slug: string
  /** Navigation label and the overlay's header title. */
  title: string
}

export interface DocsSection {
  id: string
  title: string
  pages: DocsPage[]
}

/** The page the overlay opens on when no slug is given. Must exist. */
export const DOCS_HOME_SLUG = 'getting-started/introduction'

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    pages: [
      { slug: 'getting-started/introduction', title: 'Introduction' },
      { slug: 'getting-started/installation', title: 'Installation' },
    ],
  },
  {
    id: 'core-concepts',
    title: 'Core Concepts',
    pages: [
      { slug: 'core-concepts/conversations', title: 'Conversations' },
      { slug: 'core-concepts/projects', title: 'Projects' },
      { slug: 'core-concepts/working-directory', title: 'Working Directory' },
      { slug: 'core-concepts/permissions', title: 'Permissions' },
      { slug: 'core-concepts/interactions', title: 'Interactions' },
    ],
  },
  {
    id: 'sources',
    title: 'Sources',
    pages: [
      { slug: 'sources/overview', title: 'Sources' },
      { slug: 'sources/mcp-servers', title: 'MCP Servers' },
      { slug: 'sources/apis', title: 'APIs' },
      { slug: 'sources/local-filesystems', title: 'Local Folders' },
    ],
  },
  {
    id: 'skills',
    title: 'Skills',
    pages: [
      { slug: 'skills/overview', title: 'Skills' },
    ],
  },
  {
    id: 'statuses',
    title: 'Statuses',
    pages: [
      { slug: 'statuses/overview', title: 'Statuses' },
      { slug: 'statuses/customizing', title: 'Customizing Statuses' },
    ],
  },
  {
    id: 'labels',
    title: 'Labels',
    pages: [
      { slug: 'labels/overview', title: 'Labels' },
      { slug: 'labels/auto-rules', title: 'Auto-Apply Rules' },
    ],
  },
  {
    id: 'automations',
    title: 'Automations',
    pages: [
      { slug: 'automations/overview', title: 'Automations' },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging',
    pages: [
      { slug: 'messaging/overview', title: 'Messaging' },
      { slug: 'messaging/telegram', title: 'Telegram' },
      { slug: 'messaging/whatsapp', title: 'WhatsApp' },
      { slug: 'messaging/lark', title: 'Lark / Feishu' },
      { slug: 'messaging/wechat-wecom', title: 'WeChat and WeCom' },
    ],
  },
  {
    id: 'browser',
    title: 'Browser',
    pages: [
      { slug: 'browser/overview', title: 'Browser' },
      { slug: 'browser/examples', title: 'Examples and Recipes' },
      { slug: 'browser/api-discovery', title: 'API Discovery' },
    ],
  },
  {
    id: 'customisation',
    title: 'Customisation',
    pages: [
      { slug: 'customisation/themes', title: 'Themes' },
      { slug: 'customisation/colors', title: 'Colors' },
      { slug: 'customisation/icons', title: 'Icons' },
    ],
  },
  {
    id: 'go-further',
    title: 'Go Further',
    pages: [
      { slug: 'go-further/workspaces', title: 'Workspaces' },
      { slug: 'go-further/pages', title: 'Pages' },
      { slug: 'go-further/kanban', title: 'Kanban Board' },
      { slug: 'go-further/tasks', title: 'Tasks' },
      { slug: 'go-further/rich-output', title: 'Rich Output' },
      { slug: 'go-further/document-tools', title: 'Document Tools' },
      { slug: 'go-further/connect-to-anything', title: 'Connect to Anything' },
      { slug: 'go-further/deep-links', title: 'Deep Links' },
      { slug: 'go-further/performance', title: 'Performance' },
    ],
  },
  {
    id: 'server',
    title: 'Server',
    pages: [
      { slug: 'server/remote-server', title: 'Remote Server' },
    ],
  },
  {
    id: 'reference',
    title: 'Reference',
    pages: [
      { slug: 'reference/config-file', title: 'App Settings' },
      { slug: 'reference/preferences', title: 'Preferences' },
      { slug: 'reference/llm-connections', title: 'LLM Connections' },
      { slug: 'reference/custom-endpoint', title: 'Custom Endpoints' },
      { slug: 'reference/credentials', title: 'Credentials' },
      { slug: 'reference/network-proxy', title: 'Network Proxy' },
      { slug: 'reference/environment-variables', title: 'Environment Variables' },
      { slug: 'reference/cli-reference', title: 'CLI Reference' },
    ],
  },
]

/** Flat, in-navigation-order view of every page. */
export const DOCS_PAGES: DocsPage[] = DOCS_SECTIONS.flatMap((section) => section.pages)

const PAGE_BY_SLUG = new Map(DOCS_PAGES.map((page) => [page.slug, page]))

export function findDocsPage(slug: string | null | undefined): DocsPage | undefined {
  return slug ? PAGE_BY_SLUG.get(slug) : undefined
}

/** The section a page belongs to — used for the overlay's breadcrumb. */
export function findDocsSection(slug: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((section) => section.pages.some((page) => page.slug === slug))
}
