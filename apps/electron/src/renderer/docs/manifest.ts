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
export const DOCS_LOCALES = ['en', 'zh-Hans'] as const

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
  titleZh?: string
}

export interface DocsSection {
  id: string
  title: string
  titleZh?: string
  pages: DocsPage[]
}

/** The page the overlay opens on when no slug is given. Must exist. */
export const DOCS_HOME_SLUG = 'getting-started/introduction'

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started', titleZh: '开始使用',
    pages: [
      { slug: 'getting-started/introduction', title: 'Introduction', titleZh: '简介' },
      { slug: 'getting-started/installation', title: 'Installation', titleZh: '安装' },
    ],
  },
  {
    id: 'core-concepts',
    title: 'Core Concepts', titleZh: '核心概念',
    pages: [
      { slug: 'core-concepts/conversations', title: 'Conversations', titleZh: '会话' },
      { slug: 'core-concepts/projects', title: 'Projects', titleZh: '项目' },
      { slug: 'core-concepts/working-directory', title: 'Working Directory', titleZh: '工作目录' },
      { slug: 'core-concepts/permissions', title: 'Permissions', titleZh: '权限' },
      { slug: 'core-concepts/interactions', title: 'Interactions', titleZh: '交互请求' },
    ],
  },
  {
    id: 'sources',
    title: 'Sources', titleZh: '来源',
    pages: [
      { slug: 'sources/overview', title: 'Sources', titleZh: '来源' },
      { slug: 'sources/mcp-servers', title: 'MCP Servers', titleZh: 'MCP 服务器' },
      { slug: 'sources/apis', title: 'APIs', titleZh: 'API 接口' },
      { slug: 'sources/local-filesystems', title: 'Local Folders', titleZh: '本地文件夹' },
    ],
  },
  {
    id: 'skills',
    title: 'Skills', titleZh: '技能',
    pages: [
      { slug: 'skills/overview', title: 'Skills', titleZh: '技能' },
    ],
  },
  {
    id: 'plugins',
    title: 'Plugins', titleZh: '插件',
    pages: [
      { slug: 'plugins/overview', title: 'Plugins', titleZh: '插件' },
    ],
  },
  {
    id: 'statuses',
    title: 'Statuses', titleZh: '状态',
    pages: [
      { slug: 'statuses/overview', title: 'Statuses', titleZh: '状态' },
      { slug: 'statuses/customizing', title: 'Customizing Statuses', titleZh: '自定义状态' },
    ],
  },
  {
    id: 'labels',
    title: 'Labels', titleZh: '标签',
    pages: [
      { slug: 'labels/overview', title: 'Labels', titleZh: '标签' },
      { slug: 'labels/auto-rules', title: 'Auto-Apply Rules', titleZh: '自动应用规则' },
    ],
  },
  {
    id: 'automations',
    title: 'Automations', titleZh: '自动化',
    pages: [
      { slug: 'automations/overview', title: 'Automations', titleZh: '自动化' },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging', titleZh: '消息平台',
    pages: [
      { slug: 'messaging/overview', title: 'Messaging', titleZh: '消息平台' },
      { slug: 'messaging/telegram', title: 'Telegram', titleZh: 'Telegram 消息' },
      { slug: 'messaging/whatsapp', title: 'WhatsApp', titleZh: 'WhatsApp 消息' },
      { slug: 'messaging/lark', title: 'Lark / Feishu', titleZh: 'Lark / 飞书' },
      { slug: 'messaging/wechat-wecom', title: 'WeChat and WeCom', titleZh: '微信与企业微信' },
    ],
  },
  {
    id: 'browser',
    title: 'Browser', titleZh: '浏览器',
    pages: [
      { slug: 'browser/overview', title: 'Browser', titleZh: '浏览器' },
      { slug: 'browser/examples', title: 'Examples and Recipes', titleZh: '示例与操作方法' },
      { slug: 'browser/api-discovery', title: 'API Discovery', titleZh: 'API 发现' },
    ],
  },
  {
    id: 'customisation',
    title: 'Customisation', titleZh: '个性化',
    pages: [
      { slug: 'customisation/themes', title: 'Themes', titleZh: '主题' },
      { slug: 'customisation/colors', title: 'Colors', titleZh: '颜色' },
      { slug: 'customisation/icons', title: 'Icons', titleZh: '图标' },
    ],
  },
  {
    id: 'go-further',
    title: 'Go Further', titleZh: '进阶',
    pages: [
      { slug: 'go-further/workspaces', title: 'Workspaces', titleZh: '工作区' },
      { slug: 'go-further/pages', title: 'Pages', titleZh: '页面' },
      { slug: 'go-further/kanban', title: 'Kanban Board', titleZh: '看板' },
      { slug: 'go-further/tasks', title: 'Tasks', titleZh: '任务' },
      { slug: 'go-further/rich-output', title: 'Rich Output', titleZh: '丰富输出' },
      { slug: 'go-further/document-tools', title: 'Document Tools', titleZh: '文档工具' },
      { slug: 'go-further/connect-to-anything', title: 'Connect to Anything', titleZh: '连接外部系统' },
      { slug: 'go-further/deep-links', title: 'Deep Links', titleZh: '深层链接' },
      { slug: 'go-further/performance', title: 'Performance', titleZh: '性能' },
    ],
  },
  {
    id: 'server',
    title: 'Server', titleZh: '服务端',
    pages: [
      { slug: 'server/remote-server', title: 'Remote Server', titleZh: '远程服务端' },
    ],
  },
  {
    id: 'reference',
    title: 'Reference', titleZh: '参考',
    pages: [
      { slug: 'reference/config-file', title: 'App Settings', titleZh: '应用设置' },
      { slug: 'reference/preferences', title: 'Preferences', titleZh: '偏好设置' },
      { slug: 'reference/llm-connections', title: 'LLM Connections', titleZh: '模型连接' },
      { slug: 'reference/custom-endpoint', title: 'Custom Endpoints', titleZh: '自定义端点' },
      { slug: 'reference/credentials', title: 'Credentials', titleZh: '凭据' },
      { slug: 'reference/network-proxy', title: 'Network Proxy', titleZh: '网络代理' },
      { slug: 'reference/environment-variables', title: 'Environment Variables', titleZh: '环境变量' },
      { slug: 'reference/cli-reference', title: 'CLI Reference', titleZh: '命令行参考' },
    ],
  },
]

/** Flat, in-navigation-order view of every page. */
export const DOCS_PAGES: DocsPage[] = DOCS_SECTIONS.flatMap((section) => section.pages)

const PAGE_BY_SLUG = new Map(DOCS_PAGES.map((page) => [page.slug, page]))

export function resolveDocsLocale(language: string | null | undefined): DocsLocale {
  return language?.toLowerCase().startsWith('zh') ? 'zh-Hans' : DEFAULT_DOCS_LOCALE
}
const localize = <T extends { title: string; titleZh?: string }>(entry: T, locale: DocsLocale): T => ({ ...entry, title: locale === 'zh-Hans' ? entry.titleZh ?? entry.title : entry.title })
export function getDocsSections(locale: DocsLocale): DocsSection[] {
  return DOCS_SECTIONS.map(section => ({ ...localize(section, locale), pages: section.pages.map(page => localize(page, locale)) }))
}
export function findDocsPage(slug: string | null | undefined, locale: DocsLocale = DEFAULT_DOCS_LOCALE): DocsPage | undefined {
  const page = slug ? PAGE_BY_SLUG.get(slug) : undefined
  return page ? localize(page, locale) : undefined
}

/** The section a page belongs to — used for the overlay's breadcrumb. */
export function findDocsSection(slug: string, locale: DocsLocale = DEFAULT_DOCS_LOCALE): DocsSection | undefined {
  return getDocsSections(locale).find((section) => section.pages.some((page) => page.slug === slug))
}
