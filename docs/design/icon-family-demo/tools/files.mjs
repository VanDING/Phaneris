/**
 * 文件浏览器图标主题：文件名 → 语义类型 → 彩色主题图形。
 *
 * kinds 里的每条规则给出：中文名、匹配规则（目录 / 文件名 / 扩展名）、
 * 两套候选彩色主题的图标名，以及取舍说明。
 * themeIcon 为空字符串表示该主题没有对应图形，由 fallback 接管。
 */

export const themes = {
  vscode: {
    prefix: 'vscode-icons',
    title: 'VSCode Icons',
    subtitle: '编辑器官方图标主题 · 配色最丰富',
    license: 'MIT',
    author: 'Roberto Huertas',
    fallback: { file: 'default-file', folder: 'default-folder', folderOpen: 'default-folder-opened' },
  },
  material: {
    prefix: 'material-icon-theme',
    title: 'Material Icon Theme',
    subtitle: '扁平几何 · 配色克制统一',
    license: 'MIT',
    author: 'Material Extensions',
    fallback: { file: 'document', folder: 'folder-base', folderOpen: 'folder-base' },
  },
}

export const kinds = [
  // 目录
  { id: 'folder', label: '目录', rule: { dir: true }, vscode: 'default-folder', material: 'folder-base', note: '默认目录；两套主题的开合表现不同，见下一条。' },
  { id: 'folderOpen', label: '展开目录', rule: { dir: true, open: true }, vscode: 'default-folder-opened', material: 'folder-base', note: '展开态换图形与底色，是彩色主题相对单色最明显的收益；Material 主题开合共用一张图。' },
  { id: 'folderSrc', label: '源码目录', rule: { dir: true, name: ['src', 'source'] }, vscode: 'folder-type-src', material: 'folder-src', note: '按目录名着色，一眼分辨代码与文档。' },
  { id: 'folderTest', label: '测试目录', rule: { dir: true, name: ['test', 'tests', '__tests__', 'spec', 'e2e'] }, vscode: 'folder-type-test', material: 'folder-test', note: '' },
  { id: 'folderDocs', label: '文档目录', rule: { dir: true, name: ['docs', 'doc', 'documentation'] }, vscode: 'folder-type-docs', material: 'folder-docs', note: '' },
  { id: 'folderNode', label: '依赖目录', rule: { dir: true, name: ['node_modules', 'vendor'] }, vscode: 'folder-type-node', material: 'folder-node', note: '依赖目录默认弱化显示，避免喧哗。' },
  { id: 'folderGit', label: '版本目录', rule: { dir: true, name: ['.git', '.github'] }, vscode: 'folder-type-git', material: 'folder-git', note: '' },
  { id: 'folderBuild', label: '构建产物', rule: { dir: true, name: ['dist', 'build', 'out', 'release'] }, vscode: 'folder-type-dist', material: 'folder-dist', note: '' },
  { id: 'folderAssets', label: '资源目录', rule: { dir: true, name: ['assets', 'images', 'img', 'icons', 'public', 'static'] }, vscode: 'folder-type-images', material: 'folder-images', note: '' },
  { id: 'folderComponents', label: '组件目录', rule: { dir: true, name: ['components', 'ui', 'widgets'] }, vscode: 'folder-type-component', material: 'folder-components', note: '' },
  { id: 'folderConfig', label: '配置目录', rule: { dir: true, name: ['config', 'configs', '.config'] }, vscode: 'folder-type-config', material: 'folder-config', note: '' },

  // 源码
  { id: 'ts', label: 'TypeScript', rule: { ext: ['ts', 'mts', 'cts'] }, vscode: 'file-type-typescript', material: 'typescript', note: '全仓库最高频类型（6860 个 .ts）。' },
  { id: 'tsx', label: 'TSX 组件', rule: { ext: ['tsx'] }, vscode: 'file-type-reactts', material: 'react-ts', note: '' },
  { id: 'js', label: 'JavaScript', rule: { ext: ['js', 'mjs', 'cjs'] }, vscode: 'file-type-js', material: 'javascript', note: '' },
  { id: 'jsx', label: 'JSX 组件', rule: { ext: ['jsx'] }, vscode: 'file-type-reactjs', material: 'react', note: '' },
  { id: 'vue', label: 'Vue', rule: { ext: ['vue'] }, vscode: 'file-type-vue', material: 'vue', note: '' },
  { id: 'svelte', label: 'Svelte', rule: { ext: ['svelte'] }, vscode: 'file-type-svelte', material: 'svelte', note: '' },
  { id: 'py', label: 'Python', rule: { ext: ['py', 'pyi'] }, vscode: 'file-type-python', material: 'python', note: '' },
  { id: 'go', label: 'Go', rule: { ext: ['go'] }, vscode: 'file-type-go', material: 'go', note: '' },
  { id: 'rust', label: 'Rust', rule: { ext: ['rs'] }, vscode: 'file-type-rust', material: 'rust', note: '' },
  { id: 'java', label: 'Java', rule: { ext: ['java', 'jar'] }, vscode: 'file-type-java', material: 'java', note: '' },
  { id: 'kotlin', label: 'Kotlin', rule: { ext: ['kt', 'kts'] }, vscode: 'file-type-kotlin', material: 'kotlin', note: '' },
  { id: 'swift', label: 'Swift', rule: { ext: ['swift'] }, vscode: 'file-type-swift', material: 'swift', note: '' },
  { id: 'ruby', label: 'Ruby', rule: { ext: ['rb'] }, vscode: 'file-type-ruby', material: 'ruby', note: '' },
  { id: 'php', label: 'PHP', rule: { ext: ['php'] }, vscode: 'file-type-php', material: 'php', note: '' },
  { id: 'cpp', label: 'C / C++', rule: { ext: ['c', 'h', 'cpp', 'hpp', 'cc'] }, vscode: 'file-type-cpp', material: 'cpp', note: '' },
  { id: 'csharp', label: 'C#', rule: { ext: ['cs'] }, vscode: 'file-type-csharp', material: 'csharp', note: '' },

  // 脚本与终端
  { id: 'shell', label: 'Shell 脚本', rule: { ext: ['sh', 'bash', 'zsh', 'fish'] }, vscode: 'file-type-shell', material: 'console', note: '仓库里 9 个 .sh，另有 .cmd/.nsh 由 shell 兜底。' },
  { id: 'powershell', label: 'PowerShell', rule: { ext: ['ps1', 'psm1'] }, vscode: 'file-type-powershell', material: 'powershell', note: '' },
  { id: 'batch', label: '批处理', rule: { ext: ['cmd', 'bat', 'nsh'] }, vscode: 'file-type-shell', material: 'console', note: '两套主题都没有独立 .cmd 图形，与 shell 共用。' },

  // 数据与文档
  { id: 'json', label: 'JSON', rule: { ext: ['json', 'jsonc', 'json5', 'jsonl'] }, vscode: 'file-type-json', material: 'json', note: '' },
  { id: 'yaml', label: 'YAML', rule: { ext: ['yaml', 'yml'] }, vscode: 'file-type-yaml', material: 'yaml', note: '' },
  { id: 'toml', label: 'TOML', rule: { ext: ['toml'] }, vscode: 'file-type-toml', material: 'toml', note: '' },
  { id: 'ini', label: '配置 / 环境变量', rule: { ext: ['ini', 'cfg', 'conf'], name: ['.env', '.env.example', '.env.local', '.editorconfig'] }, vscode: 'file-type-ini', material: 'settings', note: '' },
  { id: 'markdown', label: 'Markdown', rule: { ext: ['md', 'markdown'] }, vscode: 'file-type-markdown', material: 'markdown', note: '仓库 701 个 .md，是文档主力。' },
  { id: 'mdx', label: 'MDX', rule: { ext: ['mdx'] }, vscode: 'file-type-mdx', material: 'mdx', note: '' },
  { id: 'text', label: '纯文本', rule: { ext: ['txt'] }, vscode: 'file-type-text', material: 'document', note: 'Material 主题没有 .txt 专用图形，与默认文件同形。' },
  { id: 'log', label: '日志', rule: { ext: ['log'] }, vscode: 'file-type-log', material: 'log', note: '471 个 .log，主要是验证产物。' },
  { id: 'csv', label: 'CSV', rule: { ext: ['csv', 'tsv'] }, vscode: 'file-type-csv', material: 'table', note: 'Material 主题未区分 CSV 与 Excel，都用表格轮廓。' },
  { id: 'excel', label: 'Excel 表格', rule: { ext: ['xlsx', 'xls', 'xlsm'] }, vscode: 'file-type-excel', material: 'table', note: 'Material 主题缺少 Excel 专用图形。' },
  { id: 'word', label: 'Word 文档', rule: { ext: ['docx', 'doc'] }, vscode: 'file-type-word', material: 'word', note: '' },
  { id: 'pdf', label: 'PDF', rule: { ext: ['pdf'] }, vscode: 'file-type-pdf', material: 'pdf', note: '' },
  { id: 'notebook', label: 'Notebook', rule: { ext: ['ipynb'] }, vscode: 'file-type-jupyter', material: 'jupyter', note: '' },

  // 前端资源
  { id: 'css', label: 'CSS', rule: { ext: ['css'] }, vscode: 'file-type-css', material: 'css', note: '' },
  { id: 'scss', label: 'Sass / Less', rule: { ext: ['scss', 'sass', 'less'] }, vscode: 'file-type-sass', material: 'sass', note: '' },
  { id: 'html', label: 'HTML', rule: { ext: ['html', 'htm'] }, vscode: 'file-type-html', material: 'html', note: '' },
  { id: 'svg', label: 'SVG', rule: { ext: ['svg'] }, vscode: 'file-type-svg', material: 'svg', note: '演示页本身也用 SVG 内联。' },

  // 媒体
  { id: 'image', label: '位图图片', rule: { ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff'] }, vscode: 'file-type-image', material: 'image', note: '239 个 .png 是截图与验证产物。' },
  { id: 'audio', label: '音频', rule: { ext: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }, vscode: 'file-type-audio', material: 'audio', note: '' },
  { id: 'video', label: '视频', rule: { ext: ['mp4', 'mov', 'webm', 'avi', 'mkv'] }, vscode: 'file-type-video', material: 'video', note: '' },
  { id: 'font', label: '字体', rule: { ext: ['ttf', 'otf', 'woff', 'woff2', 'eot'] }, vscode: 'file-type-font', material: 'font', note: '' },

  // 工程与工具
  { id: 'lock', label: '锁文件', rule: { name: ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock'], ext: ['lock'] }, vscode: 'file-type-bun', material: 'bun', note: '本仓库的锁文件是 bun.lock，两套主题都有 Bun 专用图形；VSCode 主题缺少通用锁图形。' },
  { id: 'bun', label: 'Bun 配置', rule: { name: ['bunfig.toml'] }, vscode: 'file-type-bunfig', material: 'bun', note: '仓库独有的 Bun 工具链文件，两套主题都有专用图形。' },
  { id: 'npm', label: '包清单', rule: { name: ['package.json', 'package.json5'] }, vscode: 'file-type-npm', material: 'npm', note: 'package.json 优先于 JSON 规则。' },
  { id: 'tsconfig', label: 'TS 配置', rule: { name: ['tsconfig.json'], prefix: ['tsconfig.'] }, vscode: 'file-type-tsconfig', material: 'tsconfig', note: '仓库有 8 个 tsconfig 变体，前缀匹配统一处理。' },
  { id: 'eslint', label: 'ESLint', rule: { prefix: ['eslint.config', '.eslintrc'] }, vscode: 'file-type-eslint', material: 'eslint', note: '' },
  { id: 'prettier', label: 'Prettier', rule: { prefix: ['.prettierrc', 'prettier.config'] }, vscode: 'file-type-prettier', material: 'prettier', note: '' },
  { id: 'docker', label: 'Docker', rule: { name: ['Dockerfile', 'Dockerfile.server'], prefix: ['docker-compose', 'Dockerfile.'] }, vscode: 'file-type-docker', material: 'docker', note: '仓库有 Dockerfile.server，属于前缀变体。' },
  { id: 'git', label: 'Git 文件', rule: { name: ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep'] }, vscode: 'file-type-git', material: 'git', note: '' },
  { id: 'makefile', label: 'Makefile', rule: { name: ['Makefile', 'makefile', 'GNUmakefile'] }, vscode: 'file-type-gnu', material: 'makefile', note: 'VSCode 主题用 GNU 图形代表 Makefile。' },
  { id: 'readme', label: 'README', rule: { prefix: ['README', 'readme'] }, vscode: 'file-type-markdown', material: 'readme', note: 'Material 主题有专门 README 图形，VSCode 主题复用 Markdown。' },
  { id: 'license', label: '许可证', rule: { prefix: ['LICENSE', 'LICENCE', 'NOTICE', 'COPYING'] }, vscode: 'file-type-license', material: 'license', note: '235 个 LICENSE，多为依赖目录产物。' },
  { id: 'sql', label: 'SQL', rule: { ext: ['sql'] }, vscode: 'file-type-sql', material: 'database', note: '' },
  { id: 'sqlite', label: 'SQLite 数据库', rule: { ext: ['db', 'sqlite', 'sqlite3'] }, vscode: 'file-type-sqlite', material: 'database', note: '11 个 .db（会话存储）。' },
  { id: 'graphql', label: 'GraphQL', rule: { ext: ['graphql', 'gql'] }, vscode: 'file-type-graphql', material: 'graphql', note: '' },
  { id: 'proto', label: 'Protobuf', rule: { ext: ['proto'] }, vscode: 'file-type-protobuf', material: 'proto', note: '' },
  { id: 'wasm', label: 'WebAssembly', rule: { ext: ['wasm', 'wat'] }, vscode: 'file-type-wasm', material: 'webassembly', note: '' },
  { id: 'diff', label: '补丁 / 差异', rule: { ext: ['patch', 'diff'] }, vscode: 'file-type-diff', material: 'diff', note: '' },
  { id: 'binary', label: '可执行 / 二进制', rule: { ext: ['exe', 'dll', 'so', 'dylib', 'bin', 'node'] }, vscode: 'file-type-binary', material: 'exe', note: 'Material 主题用 exe 图形代表所有二进制。' },
  { id: 'vscode', label: '编辑器配置', rule: { name: ['.vscodeignore'], prefix: ['.vscode/'] }, vscode: 'file-type-vscode', material: 'vscode', note: '' },
]
