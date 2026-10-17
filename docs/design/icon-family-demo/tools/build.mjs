/**
 * Build the self-contained demo: inlines icon data, mapping and the app bundle
 * into a single offline index.html.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { purposes, groups } from './mapping.mjs'
import { kinds, themes } from './files.mjs'
import { validateMapping, validateFiles } from './validate.mjs'

// The demo claims "a missing icon name fails the build" — so it does.
const mappingCheck = await validateMapping()
const fileCheck = await validateFiles()
const problems = [...mappingCheck.problems, ...fileCheck.problems]
if (problems.length) {
  console.error(`构建中止：映射校验未通过（${problems.length} 项）\n` + problems.join('\n'))
  process.exit(1)
}

const ASSETS = new URL('./assets/', import.meta.url)
const SRC = new URL('../src/', import.meta.url)
const OUT = new URL('../index.html', import.meta.url)

const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))
const readText = async (url) => readFile(url, 'utf8')

const UI_SETS = ['line-md', 'ci', 'mi', 'svg-spinners']
const FILE_SETS = { vscode: 'vscode-icons', material: 'material-icon-theme' }
/** Compact an Iconify set: { name: {b,w,h,t,l} } — only what rendering needs. */
function compact(icons) {
  const out = {}
  for (const [name, icon] of Object.entries(icons)) {
    const body = icon.body ?? icon.b
    if (typeof body !== 'string' || body.length === 0) throw new Error(`icon "${name}" has no SVG body`)
    const entry = { b: body }
    if (icon.width != null) entry.w = icon.width
    if (icon.height != null) entry.h = icon.height
    if (icon.left) entry.l = icon.left
    if (icon.top) entry.t = icon.top
    out[name] = entry
  }
  return out
}

const sets = {}
const setMeta = {}
for (const prefix of UI_SETS) {
  const data = await readJson(`icons-${prefix}.json`)
  const collection = await readJson(`collection-${prefix}.json`)
  sets[prefix] = {
    width: data.width ?? collection.width ?? 24,
    height: data.height ?? collection.height ?? 24,
    icons: compact(data.icons),
  }
  setMeta[prefix] = {
    prefix,
    title: collection.name ?? prefix,
    author: collection.author?.name ?? '',
    license: collection.license?.title ?? '',
    licenseUrl: collection.license?.url ?? '',
    total: collection.total ?? Object.keys(data.icons).length,
    categories: Object.keys(collection.categories ?? {}),
    categoryNames: Object.fromEntries(Object.entries(collection.categories ?? {}).flatMap(([title, list]) => list.map((n) => [n, title]))),
    height: collection.height ?? 24,
  }
}

// Current baseline: extracted from the installed lucide-react package (offline, version-exact).
{
  const data = await readJson('icons-lucide.json')
  sets.lucide = { width: 24, height: 24, icons: compact(data.icons) }
  setMeta.lucide = {
    prefix: 'lucide',
    title: 'Lucide（当前基线）',
    author: 'Lucide Contributors',
    license: 'ISC',
    licenseUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    total: Object.keys(data.icons).length,
    categories: [],
    categoryNames: {},
    height: 24,
    note: '从本仓库安装的 lucide-react v1.51.0 中直接提取，与当前界面渲染一致。',
  }
}

// File themes only need the icons the mapping actually uses.
const fileSets = {}
for (const [key, prefix] of Object.entries(FILE_SETS)) {
  const data = await readJson(`icons-${prefix}.json`)
  const collection = await readJson(`collection-${prefix}.json`)
  setMeta[prefix] = {
    prefix,
    title: collection.name ?? prefix,
    author: collection.author?.name ?? '',
    license: collection.license?.title ?? '',
    licenseUrl: collection.license?.url ?? '',
    total: collection.total ?? Object.keys(data.icons).length,
    categories: [],
    categoryNames: {},
    height: collection.height ?? 32,
  }
  const wanted = new Set([...kinds.map((k) => k[key]), ...Object.values(themes[key].fallback)])
  const icons = {}
  for (const name of wanted) if (data.icons[name]) icons[name] = data.icons[name]
  fileSets[key] = {
    width: data.width ?? 32,
    height: data.height ?? 24,
    icons: compact(icons),
  }
}

// Author/license live in /collections only, so merge that metadata over the sets.
const licenses = await readJson('set-licenses.json')
for (const [prefix, meta] of Object.entries(setMeta)) {
  const extra = licenses[prefix]
  if (!extra) continue
  meta.officialName = extra.name
  meta.author = extra.author || meta.author
  meta.authorUrl = extra.authorUrl
  meta.license = extra.license || meta.license
  meta.licenseSpdx = extra.licenseSpdx
  meta.licenseUrl = extra.licenseUrl || meta.licenseUrl
}

// A realistic workspace tree that exercises the whole type mapping.
const tree = [
  { name: 'apps', kind: 'folderSrc', open: true, children: [
    { name: 'electron', kind: 'folder', open: true, children: [
      { name: 'package.json', kind: 'npm' },
      { name: 'tsconfig.json', kind: 'tsconfig' },
      { name: 'App.tsx', kind: 'tsx' },
      { name: 'main.ts', kind: 'ts' },
    ] },
    { name: 'viewer', kind: 'folder', children: [] },
  ] },
  { name: 'packages', kind: 'folder', open: true, children: [
    { name: 'ui', kind: 'folder', children: [{ name: 'index.css', kind: 'css' }, { name: 'theme.scss', kind: 'scss' }] },
    { name: 'shared', kind: 'folder', children: [{ name: 'session.db', kind: 'sqlite' }] },
  ] },
  { name: 'docs', kind: 'folderDocs', open: true, children: [
    { name: 'icon-selection.md', kind: 'markdown' },
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
  { name: 'bundle.zip', kind: 'zip' },
  { name: 'notebook.ipynb', kind: 'notebook' },
  { name: 'settings.ini', kind: 'ini' },
  { name: 'unknown.xyz', kind: 'file' },
]

const payload = {
  builtAt: new Date().toISOString(),
  groups,
  purposes,
  setMeta,
  sets,
  files: {
    themes: Object.fromEntries(Object.entries(themes).map(([key, theme]) => [key, {
      ...theme,
      meta: setMeta[theme.prefix] ?? null,
      count: Object.keys(fileSets[key].icons).length,
    }])),
    kinds,
    tree,
  },
  fileSets,
  survey: await readJson('lucide-usage.json'),
  validation: { mapping: mappingCheck.stats, files: fileCheck.stats },
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
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(JSON.stringify({
  output: 'docs/design/icon-family-demo/index.html',
  total: kb(size),
  purposes: purposes.length,
  fileKinds: kinds.length,
  uiSets: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, `${Object.keys(v.icons).length} icons`])),
  fileThemes: Object.fromEntries(Object.entries(fileSets).map(([k, v]) => [k, `${Object.keys(v.icons).length} icons`])),
  lucidePlaced: `${mappingCheck.stats.placed}/${mappingCheck.stats.surveyed}`,
}, null, 2))
