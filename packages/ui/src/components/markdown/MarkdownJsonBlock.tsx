/**
 * MarkdownJsonBlock - Interactive JSON tree viewer for markdown code blocks
 *
 * When the markdown viewer encounters a ```json code block, this component
 * renders it with the same @uiw/react-json-view setup and styling used in
 * JSONPreviewOverlay, instead of static Shiki syntax highlighting.
 *
 * - Parses the raw code string as JSON
 * - Recursively expands stringified-JSON-within-JSON (deepParseJson)
 * - Uses craft themes (transparent bg, CSS variable fonts)
 * - Defaults to collapsed={2} for inline chat context
 * - Falls back to CodeBlock if JSON parsing or rendering fails
 *
 * Performance: `@uiw/react-json-view` (and its two theme modules) is loaded on
 * demand, not with the chat bundle. Every markdown document imports this module
 * through `Markdown.tsx`, so a static import put an alpha dependency plus two
 * theme objects on the first-paint path for users who never open a JSON block.
 * The CodeBlock fallback renders immediately and is swapped for the interactive
 * tree once the module resolves.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'

// ── Lazy JSON viewer ───────────────────────────────────────────────────────
// Transparent background so the container's bg-muted/30 shows through, and a
// CSS variable font so it matches the app's monospace font.

const JSON_THEME_FONT = 'var(--font-mono, ui-monospace, monospace)'

interface JsonViewModule {
  View: React.ComponentType<Record<string, unknown>>
  Copied: React.ComponentType<{ render?: (props: Record<string, unknown>) => React.ReactNode }>
  darkTheme: Record<string, string>
  lightTheme: Record<string, string>
}

let cachedJsonView: JsonViewModule | null = null
let loadingJsonView: Promise<JsonViewModule> | null = null

function loadJsonView(): Promise<JsonViewModule> {
  if (cachedJsonView) return Promise.resolve(cachedJsonView)
  loadingJsonView ??= (async () => {
    const [module, vscode, github] = await Promise.all([
      import('@uiw/react-json-view'),
      import('@uiw/react-json-view/vscode'),
      import('@uiw/react-json-view/githubLight'),
    ])
    const View = module.default as unknown as JsonViewModule['View'] & { Copied: JsonViewModule['Copied'] }
    cachedJsonView = {
      View,
      Copied: View.Copied,
      darkTheme: {
        ...(vscode.vscodeTheme as unknown as Record<string, string>),
        '--w-rjv-font-family': JSON_THEME_FONT,
        '--w-rjv-background-color': 'transparent',
      },
      lightTheme: {
        ...(github.githubLightTheme as unknown as Record<string, string>),
        '--w-rjv-font-family': JSON_THEME_FONT,
        '--w-rjv-background-color': 'transparent',
      },
    }
    return cachedJsonView
  })()
  return loadingJsonView
}

// ── Deep parse helper (same as JSONPreviewOverlay) ─────────────────────────
// Recursively parse stringified JSON within JSON values so nested objects
// like {"result": "{\"nested\": \"value\"}"} display as expandable nodes.

function deepParseJson(value: unknown): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return deepParseJson(JSON.parse(trimmed))
      } catch {
        return value
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(deepParseJson)
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJson(val)
    }
    return result
  }

  return value
}

// ── Error boundary ────────────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Lightweight error boundary so a JsonView failure doesn't crash the whole
 * message — we fall back to the regular CodeBlock instead.
 */
class JsonErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[MarkdownJsonBlock] JsonView render failed, falling back to CodeBlock:', error)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

// ── Main component ────────────────────────────────────────────────────────

export interface MarkdownJsonBlockProps {
  /** Raw JSON string from the markdown code block */
  code: string
  className?: string
}

export function MarkdownJsonBlock({ code, className }: MarkdownJsonBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const [jsonView, setJsonView] = React.useState<JsonViewModule | null>(cachedJsonView)

  // Try to parse – fall back to syntax-highlighted CodeBlock if invalid JSON
  const parsed = React.useMemo(() => {
    try {
      const raw = JSON.parse(code)
      return deepParseJson(raw) as object
    } catch {
      return null
    }
  }, [code])

  React.useEffect(() => {
    if (jsonView) return
    let active = true
    // A rejected import must not surface as an unhandled rejection; the
    // CodeBlock fallback stays rendered instead.
    void loadJsonView().then(module => { if (active) setJsonView(module) }).catch(() => undefined)
    return () => { active = false }
  }, [jsonView])

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy JSON:', err)
    }
  }, [code])

  const fallback = <CodeBlock code={code} language="json" mode="full" className={className} />

  if (parsed === null) return fallback
  if (!jsonView) return fallback

  const { View, Copied, darkTheme, lightTheme } = jsonView
  const jsonTheme = isDarkMode() ? darkTheme : lightTheme

  return (
    <JsonErrorBoundary fallback={fallback}>
      <div className={cn('relative group rounded-shape-lg overflow-hidden border bg-muted/30', className)}>
        {/* Header — matches CodeBlock full mode (label + copy on hover) */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b text-meta">
          <span className="text-muted-foreground font-medium uppercase tracking-wide">json</span>
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            aria-label={t('common.copyJson')}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Interactive tree viewer */}
        <div className="p-3 overflow-x-auto text-body">
          <View
            value={parsed}
            style={jsonTheme}
            collapsed={2}
            enableClipboard={true}
            displayDataTypes={false}
            shortenTextAfterLength={100}
          >
            {/* Custom copy icon — same as JSONPreviewOverlay */}
            <Copied
              render={(props) => {
                const isCopied = props['data-copied']
                return isCopied ? (
                  <Check
                    className="ml-1.5 inline-flex cursor-pointer text-success-text"
                    size={10}
                    onClick={props.onClick as React.MouseEventHandler}
                  />
                ) : (
                  <Copy
                    className="ml-1.5 inline-flex cursor-pointer text-muted-foreground hover:text-foreground"
                    size={10}
                    onClick={props.onClick as React.MouseEventHandler}
                  />
                )
              }}
            />
          </View>
        </div>
      </div>
    </JsonErrorBoundary>
  )
}
