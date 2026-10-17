/**
 * Build the Lucide revision demo: validate the plan, then inline the plan,
 * the full local icon catalogue, VSCode Icons and blocks-wave into one file.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolvePlan } from './resolve-plan.mjs'
import { kinds, themes } from './files.mjs'

const ASSETS = new URL('../assets/', import.meta.url)
const SRC = new URL('../src/', import.meta.url)
const OUT = new URL('../index.html', import.meta.url)

const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))
const readText = async (url) => readFile(url, 'utf8')

// 1. The plan must resolve: every icon name real, every component placed.
const plan = await resolvePlan()
if (plan.problems.length) {
  console.error(`构建中止：方案校验未通过（${plan.problems.length} 项）\n` + plan.problems.join('\n'))
  process.exit(1)
}

const catalog = await readJson('lucide-catalog.json')
const survey = await readJson('lucide-usage.json')
const audit = await readJson('audit.json')
const licenses = await readJson('set-licenses.json')

function compact(icons) {
  const out = {}
  for (const [name, icon] of Object.entries(icons)) {
    const body = icon.body ?? icon.b ?? (typeof icon === 'string' ? icon : null)
    if (typeof body !== 'string' || !body) throw new Error(`icon "${name}" has no SVG body`)
    const entry = { b: body }
    if (icon.width != null) entry.w = icon.width
    if (icon.height != null) entry.h = icon.height
    if (icon.left) entry.l = icon.left
    if (icon.top) entry.t = icon.top
    out[name] = entry
  }
  return out
}

// 2. VSCode Icons: only the icons the file mapping actually uses.
const vscodeRaw = await readJson('icons-vscode-icons.json')
const vscodeCollection = await readJson('collection-vscode-icons.json')
const vscodeTheme = themes.vscode
const vscodeWanted = new Set([...kinds.map((k) => k.vscode), ...Object.values(vscodeTheme.fallback)])
const vscodeIcons = {}
for (const name of vscodeWanted) if (vscodeRaw.icons[name]) vscodeIcons[name] = vscodeRaw.icons[name]
const missingVscode = [...vscodeWanted].filter((name) => !vscodeIcons[name])
if (missingVscode.length) {
  console.error('构建中止：VSCode Icons 缺少 ' + missingVscode.join(', '))
  process.exit(1)
}

// 3. blocks-wave, the approved thinking animation.
const spinners = await readJson('icons-svg-spinners.json')
const wave = spinners.icons['blocks-wave']
if (!wave) {
  console.error('构建中止：找不到 svg-spinners:blocks-wave')
  process.exit(1)
}

// 4. A realistic workspace tree for the file browser.
const fileTree = [
  { name: 'apps', kind: 'folderSrc', open: true, children: [
    { name: 'electron', kind: 'folder', children: [
      { name: 'package.json', kind: 'npm' },
      { name: 'tsconfig.json', kind: 'tsconfig' },
      { name: 'App.tsx', kind: 'tsx' },
      { name: 'main.ts', kind: 'ts' },
    ] },
    { name: 'viewer', kind: 'folder', children: [] },
  ] },
  { name: 'packages', kind: 'folder', children: [
    { name: 'ui', kind: 'folder', children: [{ name: 'index.css', kind: 'css' }, { name: 'theme.scss', kind: 'scss' }] },
    { name: 'shared', kind: 'folder', children: [{ name: 'session.db', kind: 'sqlite' }] },
  ] },
  { name: 'docs', kind: 'folderDocs', open: true, children: [
    { name: 'icon-revision.md', kind: 'markdown' },
    { name: 'release-notes.mdx', kind: 'mdx' },
    { name: 'icon-mapping.json', kind: 'json' },
    { name: 'demo-deck.pdf', kind: 'pdf' },
    { name: 'spec.docx', kind: 'word' },
    { name: 'metrics.xlsx', kind: 'excel' },
    { name: 'index.html', kind: 'html' },
    { name: 'logo.svg', kind: 'svg' },
  ] },
  { name: 'tests', kind: 'folderTest', children: [{ name: 'session.spec.ts', kind: 'ts' }] },
  { name: 'node_modules', kind: 'folderNode', children: [] },
  { name: '.github', kind: 'folderGit', children: [{ name: 'workflows.yml', kind: 'yaml' }] },
  { name: 'dist', kind: 'folderBuild', children: [] },
  { name: 'assets', kind: 'folderAssets', children: [
    { name: 'screenshot.png', kind: 'image' },
    { name: 'avatar.ico', kind: 'image' },
    { name: 'demo.mp4', kind: 'video' },
    { name: 'voice.mp3', kind: 'audio' },
    { name: 'Inter.woff2', kind: 'font' },
  ] },
  { name: '.gitignore', kind: 'git' },
  { name: '.env.example', kind: 'ini' },
  { name: 'bun.lock', kind: 'lock' },
  { name: 'bunfig.toml', kind: 'bun' },
  { name: 'Dockerfile.server', kind: 'docker' },
  { name: 'Makefile', kind: 'makefile' },
  { name: 'README.zh-CN.md', kind: 'readme' },
  { name: 'LICENSE', kind: 'license' },
  { name: 'eslint.config.mjs', kind: 'eslint' },
  { name: 'build-server.ts', kind: 'ts' },
  { name: 'worker.py', kind: 'python' },
  { name: 'deploy.sh', kind: 'shell' },
  { name: 'scan.ps1', kind: 'powershell' },
  { name: 'query.sql', kind: 'sql' },
  { name: 'schema.graphql', kind: 'graphql' },
  { name: 'service.proto', kind: 'proto' },
  { name: 'main.wasm', kind: 'wasm' },
  { name: 'tool.exe', kind: 'binary' },
  { name: 'release.patch', kind: 'diff' },
  { name: 'run.log', kind: 'log' },
  { name: 'trace.jsonl', kind: 'json' },
  { name: 'notes.txt', kind: 'text' },
  { name: 'data.csv', kind: 'csv' },
  { name: 'bundle.zip', kind: 'archiveFile' },
  { name: 'notebook.ipynb', kind: 'notebook' },
  { name: 'settings.ini', kind: 'ini' },
  { name: 'unknown.xyz', kind: 'file' },
]

const payload = {
  builtAt: new Date().toISOString(),
  groups: plan.groups,
  purposes: plan.purposes,
  totals: { ...plan.totals, glyphsBefore: audit.totals.distinctGlyphs, componentsBefore: audit.totals.components },
  aliasRenames: audit.aliasRenames,
  sharedGlyphs: plan.shared,
  survey,
  catalog: { canonical: compact(catalog.canonical), aliases: catalog.aliases },
  icons: {
    'vscode-icons': {
      width: vscodeRaw.width ?? 32,
      height: vscodeRaw.height ?? 32,
      icons: compact(vscodeIcons),
      meta: {
        ...(licenses['vscode-icons'] ?? {}),
        total: vscodeCollection.total,
        url: 'https://icon-sets.iconify.design/vscode-icons/',
      },
    },
    'svg-spinners': {
      width: spinners.width ?? 24,
      height: spinners.height ?? 24,
      icons: compact({ 'blocks-wave': wave }),
      meta: licenses['svg-spinners'] ?? {},
    },
  },
  fileKinds: kinds,
  fileTree,
  vscodeFallback: vscodeTheme.fallback,
  licenses,
}

const template = await readText(new URL('template.html', SRC))
const styles = await readText(new URL('styles.css', SRC))
const app = await readText(new URL('app.js', SRC))

const html = template
  .replace('/* @@STYLES@@ */', () => styles)
  .replace('/* @@DATA@@ */', () => `window.DEMO=${JSON.stringify(payload)};`)
  .replace('/* @@APP@@ */', () => app)

await writeFile(OUT, html)
const size = (await readFile(OUT)).length
console.log(JSON.stringify({
  output: 'docs/design/lucide-icon-revision/index.html',
  size: `${(size / 1024).toFixed(0)} KB`,
  purposes: plan.purposes.length,
  recommendedIcons: plan.totals.recommendedOnly,
  allowedExtras: plan.totals.allowedExtras,
  catalogInlined: Object.keys(payload.catalog.canonical).length,
  vscodeIcons: Object.keys(payload.icons['vscode-icons'].icons).length,
  fileKinds: kinds.length,
  actions: plan.totals.actions,
}, null, 2))
