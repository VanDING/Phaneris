/**
 * TerminalOutput - Terminal-style display for command output
 *
 * Platform-agnostic component for displaying terminal output with:
 * - ANSI color code support
 * - Grep output line number highlighting
 * - Light/dark theme support
 * - Copy functionality
 */

import * as React from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal, Copy, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { parseAnsi, stripAnsi, isGrepContentOutput, parseGrepOutput } from './ansi-parser'

export type ToolType = 'bash' | 'grep' | 'glob'

export interface TerminalOutputProps {
  /** The command that was executed */
  command: string
  /** The output from the command */
  output: string
  /** Exit code (0 = success) */
  exitCode?: number
  /** Tool type for display styling */
  toolType?: ToolType
  /** Optional description of what the command does */
  description?: string
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Additional class names */
  className?: string
}

/**
 * TerminalOutput - Display terminal command and output with ANSI colors
 */
export function TerminalOutput({
  command,
  output,
  exitCode,
  toolType = 'bash',
  description,
  theme = 'light',
  className,
}: TerminalOutputProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'command' | 'output' | null>(null)

  // Chrome follows the host snapshot. ANSI spans retain the command's colors.
  const textColor = 'var(--text-primary)'
  const mutedColor = 'var(--text-secondary)'
  const matchColor = 'var(--success-text)'

  // Copy to clipboard (strip ANSI codes for clean text)
  const copyToClipboard = useCallback(async (text: string, type: 'command' | 'output') => {
    try {
      await navigator.clipboard.writeText(stripAnsi(text))
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  // Memoize ANSI-parsed output for performance
  const parsedOutput = useMemo(() => {
    if (!output) return []
    return parseAnsi(output)
  }, [output])

  // Check if this looks like grep content output
  const isGrepOutput = useMemo(() => {
    if (!output) return false
    return isGrepContentOutput(output)
  }, [output])

  // Parse grep output if applicable
  const grepLines = useMemo(() => {
    if (!isGrepOutput || !output) return []
    return parseGrepOutput(output)
  }, [isGrepOutput, output])

  return (
    <div
      className={cn('h-full w-full overflow-auto px-5 py-4 craft-text-code', className)}
      data-terminal-mode={theme}
    >
      {/* Command section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs" style={{ color: mutedColor }}>
            <Terminal className="w-3 h-3" />
            <span>Command</span>
          </div>
          <button
            onClick={() => copyToClipboard(command, 'command')}
            className="craft-icon-button inline-flex items-center justify-center p-1 rounded-control transition-colors hover:bg-action-hover"
            aria-label={t('terminal.copyCommand')}
            title={copied === 'command' ? t('common.copied') : t('terminal.copyCommand')}
          >
            {copied === 'command' ? (
              <Check className="h-3.5 w-3.5 text-success-text" />
            ) : (
              <Copy className="h-3.5 w-3.5" style={{ color: mutedColor }} />
            )}
          </button>
        </div>
        <div className="overflow-x-auto">
          <code className="text-foreground">{command}</code>
        </div>
      </div>

      {/* Output section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs" style={{ color: mutedColor }}>
            <Terminal className="w-3 h-3" />
            <span>{t('terminal.output')}</span>
            {exitCode !== undefined && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px]"
                style={{
                  backgroundColor: `color-mix(in srgb, var(--${exitCode === 0 ? 'success' : 'destructive'}) 12%, transparent)`,
                  color: `var(--${exitCode === 0 ? 'success' : 'destructive'}-text)`,
                }}
              >
                exit {exitCode}
              </span>
            )}
          </div>
          <button
            onClick={() => copyToClipboard(output, 'output')}
            className="craft-icon-button inline-flex items-center justify-center p-1 rounded-control transition-colors hover:bg-action-hover"
            aria-label={t('terminal.copyOutput')}
            title={copied === 'output' ? t('common.copied') : t('terminal.copyOutput')}
          >
            {copied === 'output' ? (
              <Check className="h-3.5 w-3.5 text-success-text" />
            ) : (
              <Copy className="h-3.5 w-3.5" style={{ color: mutedColor }} />
            )}
          </button>
        </div>
        <pre
          className="overflow-auto"
          style={{ color: textColor }}
        >
          {/* Grep output with line number highlighting */}
          {isGrepOutput && grepLines.length > 0 ? (
            <div className="space-y-0">
              {grepLines.map((line, i) => (
                <div
                  key={i}
                  className="flex"
                  style={{
                    backgroundColor: line.isMatch ? 'color-mix(in srgb, var(--success) 8%, transparent)' : undefined,
                  }}
                >
                  {/* Line number */}
                  {line.lineNum && (
                    <span
                      className="select-none pr-3 text-right shrink-0"
                      style={{
                        color: line.isMatch ? matchColor : mutedColor,
                        minWidth: '3rem',
                      }}
                    >
                      {line.lineNum}
                      <span style={{ color: line.isMatch ? matchColor : mutedColor }}>
                        {line.isMatch ? ':' : '-'}
                      </span>
                    </span>
                  )}
                  {/* Content */}
                  <span
                    className="whitespace-pre-wrap break-words"
                    style={{ color: line.isMatch ? textColor : mutedColor }}
                  >
                    {line.content}
                  </span>
                </div>
              ))}
            </div>
          ) : parsedOutput.length > 0 ? (
            /* ANSI-colored output */
            <div className="whitespace-pre-wrap break-words">
              {parsedOutput.map((span, i) => (
                <span
                  key={i}
                  style={{
                    color: span.fg,
                    backgroundColor: span.bg,
                    fontWeight: span.bold ? 'bold' : undefined,
                    // Add padding for background colors
                    padding: span.bg ? '0 2px' : undefined,
                    borderRadius: span.bg ? '2px' : undefined,
                  }}
                >
                  {span.text}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ color: mutedColor }}>(no output)</span>
          )}
        </pre>
      </div>
    </div>
  )
}
