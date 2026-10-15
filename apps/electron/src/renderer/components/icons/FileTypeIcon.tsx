import { cn } from '@/lib/utils'

// Bundled SVGs only: no runtime requests or additional icon runtime.
const assets = import.meta.glob<string>('../../assets/file-icons/*.svg', { eager: true, query: '?url', import: 'default' })
const iconUrl = (name: string) => assets[`../../assets/file-icons/${name}.svg`]

const EXTENSIONS: Record<string, string> = {
  py: 'python', pyi: 'python', pyw: 'python', ipynb: 'jupyter',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'react-ts',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'react',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json', ndjson: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'settings', conf: 'settings', config: 'settings', env: 'settings',
  xml: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml', html: 'html', htm: 'html',
  css: 'css', scss: 'sass', sass: 'sass', less: 'css', vue: 'vue', svelte: 'svelte',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', txt: 'document', text: 'document', rst: 'document',
  pdf: 'pdf', doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
  ppt: 'powerpoint', pptx: 'powerpoint', odp: 'powerpoint',
  xls: 'table', xlsx: 'table', ods: 'table', csv: 'table', tsv: 'table', parquet: 'table',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', ico: 'image', tiff: 'image', heic: 'image', svg: 'svg',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  zip: 'zip', tar: 'zip', gz: 'zip', tgz: 'zip', bz2: 'zip', xz: 'zip', '7z': 'zip', rar: 'zip',
  sql: 'database', db: 'database', sqlite: 'database', sqlite3: 'database',
  sh: 'console', bash: 'console', zsh: 'console', fish: 'console', bat: 'console', cmd: 'console', ps1: 'powershell', psm1: 'powershell',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  java: 'java', jar: 'java', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin', r: 'r',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', exe: 'exe', dll: 'exe', msi: 'exe',
  lock: 'lock', log: 'log', patch: 'git', diff: 'git',
}
const FILENAMES: Record<string, string> = {
  'package.json': 'nodejs', 'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', '.npmrc': 'npm',
  'bun.lock': 'bun', 'bun.lockb': 'bun', 'bunfig.toml': 'bun', 'yarn.lock': 'yarn', '.yarnrc.yml': 'yarn',
  'pnpm-lock.yaml': 'npm', 'pnpm-workspace.yaml': 'npm',
  dockerfile: 'docker', 'docker-compose.yml': 'docker', 'docker-compose.yaml': 'docker', compose: 'docker',
  'compose.yml': 'docker', 'compose.yaml': 'docker', '.dockerignore': 'docker',
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git',
  'tsconfig.json': 'typescript', 'jsconfig.json': 'javascript',
  'requirements.txt': 'python', 'pyproject.toml': 'python', 'pipfile': 'python', 'uv.lock': 'python',
  'cargo.toml': 'rust', 'cargo.lock': 'rust', 'go.mod': 'go', 'go.sum': 'go',
}
const FOLDERS: Record<string, string> = {
  src: 'src', source: 'src', lib: 'src', docs: 'docs', documents: 'docs', plans: 'docs',
  config: 'config', '.config': 'config', settings: 'config', '.vscode': 'config',
  test: 'test', tests: 'test', __tests__: 'test', '.git': 'git', '.github': 'github',
  node_modules: 'node', '.venv': 'python', venv: 'python', __pycache__: 'python',
  data: 'database', scripts: 'scripts', images: 'images', assets: 'images',
  downloads: 'download', attachments: 'attachment', temp: 'temp', tmp: 'temp', '.cache': 'temp',
  dist: 'dist', build: 'dist', components: 'components', packages: 'packages',
}

export function fileTypeIconName(name: string, directory = false, expanded = false): string {
  const lower = name.toLowerCase()
  if (directory) return `folder-${FOLDERS[lower] ?? 'base'}${expanded ? '-open' : ''}`
  if (FILENAMES[lower]) return FILENAMES[lower]
  if (/\.d\.(?:ts|mts|cts)$/.test(lower)) return 'typescript-def'
  if (/^readme(?:\.|$)/.test(lower)) return 'readme'
  if (/^(?:licen[cs]e|copying|notice)(?:\.|$)/.test(lower)) return 'license'
  if (lower === '.env' || lower.startsWith('.env.')) return 'settings'
  if (lower.startsWith('dockerfile.')) return 'docker'
  return EXTENSIONS[lower.split('.').pop() ?? ''] ?? 'document'
}

export function FileTypeIcon({ name, directory, expanded, className }: {
  name: string; directory?: boolean; expanded?: boolean; className?: string
}) {
  const icon = fileTypeIconName(name, directory, expanded)
  const imageClass = cn('size-4 shrink-0', className)
  return (
    <span className="inline-flex size-4 shrink-0" data-file-icon={icon} aria-hidden="true">
      <img src={iconUrl(icon)} alt="" width={16} height={16} draggable={false} className={cn(imageClass, icon === 'bun' && 'dark:hidden')} />
      {icon === 'bun' && <img src={iconUrl('bun-light')} alt="" width={16} height={16} draggable={false} className={cn(imageClass, 'hidden dark:block')} />}
    </span>
  )
}
