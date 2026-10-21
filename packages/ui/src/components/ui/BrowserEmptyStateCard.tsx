import * as React from 'react'
import { useTranslation } from 'react-i18next'

export interface BrowserEmptyPromptSample {
  short: string
  full: string
}

export interface BrowserEmptyStateCardProps {
  title: string
  description: string
  prompts?: readonly BrowserEmptyPromptSample[]
  showExamplePrompts?: boolean
  showSafetyHint?: boolean
  onPromptSelect?: (prompt: BrowserEmptyPromptSample) => void
}

export function BrowserEmptyStateCard({
  title,
  description,
  prompts = [],
  showExamplePrompts = true,
  showSafetyHint = true,
  onPromptSelect,
}: BrowserEmptyStateCardProps) {
  const { t } = useTranslation()
  const renderPrompt = (sample: BrowserEmptyPromptSample, index: number) => (
    <button
      key={sample.short}
      type="button"
      title={sample.full}
      onClick={() => onPromptSelect?.(sample)}
      className="motion-interactive flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="w-4 shrink-0 text-meta text-muted-foreground tabular-nums">{index + 1}.</span>
      <span className="text-label text-foreground/80">{sample.short}</span>
    </button>
  )
  return (
    <div className="w-full h-full flex items-center justify-center p-8">
      <div className="w-full max-w-[700px] bg-background shadow-minimal rounded-shape-lg overflow-hidden border border-border/50">
        <div className="px-4 py-3 border-b border-border/50 flex items-center bg-muted/20 select-none">
          <h3 className="text-body font-medium text-foreground tracking-tight">
            {title}
          </h3>
        </div>

        <div className="pl-[22px] pr-[16px] py-3 text-body">
          <p className="text-text-secondary leading-relaxed">
            {description}
          </p>

          {showExamplePrompts && prompts.length > 0 && (
            <div className="mt-3.5 space-y-1.5">
              {prompts.slice(0, 3).map(renderPrompt)}
              {prompts.length > 3 && (
                <details>
                  <summary className="cursor-pointer rounded-md px-2.5 py-2 text-label text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('common.more')}</summary>
                  <div className="motion-view-enter">{prompts.slice(3).map((sample, index) => renderPrompt(sample, index + 3))}</div>
                </details>
              )}
            </div>
          )}
        </div>

        {showSafetyHint && (
          <div className="px-4 py-2.5 border-t border-border/50 flex items-center gap-2 bg-muted/20 text-body text-text-secondary">
            <p>
              {t('browser.safetyHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
