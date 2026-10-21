/**
 * File identity for dense, single-colour contexts.
 *
 * The product had three answers to "what icon is this file": the colour asset
 * set in `FileTypeIcon` (Electron, 100+ SVGs), and two hand-copied mono glyph
 * sets — one in `UserMessageBubble`, one in `mention-menu`. The copies drifted
 * (folder/code/document paths, 12px vs 16px, stroked with hard-coded widths),
 * and a shared package cannot reach the Electron asset glob, which is why they
 * existed in the first place.
 *
 * This module is the one mono answer. It deliberately knows only three kinds:
 * colour and extension-level identity stay in `FileTypeIcon`. Callers render
 * `FileKindIcon` so the glyph inherits Lucide's themed stroke weight.
 */

/** Extensions that read as source code in a menu or an attachment badge. */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi', 'rs', 'go', 'java', 'rb', 'swift', 'kt', 'kts',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml',
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  'md', 'mdx', 'rst',
  'sql', 'graphql', 'proto',
])

export type FileKind = 'folder' | 'code' | 'document'

/** Classify a path or file name into the mono glyph set. */
export function fileKind(name: string, directory = false): FileKind {
  if (directory) return 'folder'
  // Accept a path: the extension of the last segment is what matters.
  const segment = name.replaceAll('\\', '/').split('/').pop() ?? name
  const extension = segment.includes('.') ? segment.split('.').pop()!.toLowerCase() : ''
  return CODE_EXTENSIONS.has(extension) ? 'code' : 'document'
}
