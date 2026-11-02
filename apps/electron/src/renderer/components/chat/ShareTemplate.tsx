import * as React from 'react'
import { Markdown, ShikiThemeProvider, StaticMarkdownContext } from '@phaneris/ui'
import { DEFAULT_THEME } from '@phaneris/shared/config/theme'
import type { ShareMessage } from '@/lib/share-messages'
import type { ShareInclude, SharePageSpec } from '../../../shared/share-image'
import { PhanerisSymbol } from '@/components/icons/PhanerisSymbol'
import './share-images.css'

const palette = {
  '--background': DEFAULT_THEME.background,
  '--foreground': DEFAULT_THEME.foreground,
  '--card': DEFAULT_THEME.background,
  '--border': DEFAULT_THEME.border,
  '--muted': DEFAULT_THEME.muted,
  '--muted-foreground': DEFAULT_THEME.mutedForeground,
  '--accent': DEFAULT_THEME.accent,
  '--foreground-3': 'color-mix(in srgb, ' + DEFAULT_THEME.foreground + ' 3%, transparent)',
  '--foreground-20': 'color-mix(in srgb, ' + DEFAULT_THEME.foreground + ' 20%, transparent)',
  '--foreground-30': 'color-mix(in srgb, ' + DEFAULT_THEME.foreground + ' 30%, transparent)',
  '--share-question': DEFAULT_THEME.userMessageBubble,
} as React.CSSProperties

export interface ShareTemplateLabels {
  excerpt: string
  question: string
  answer: string
  omitted: (count: number) => string
  exportedBy: string
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : ''
}

export const ShareTemplate = React.forwardRef<HTMLElement, {
  title: string
  messages: readonly ShareMessage[]
  labels: ShareTemplateLabels
  page: SharePageSpec
  include: ShareInclude
  modelName?: string
  date?: string
}>(({ title, messages, labels, page, include, modelName, date }, ref) => {
  const meta: React.ReactNode[] = []
  if (include.model && modelName) meta.push(<span key="model">{modelName}</span>)
  if (include.model && modelName && include.date && date) meta.push(<span key="sep" className="share-meta-sep">·</span>)
  if (include.date && date) meta.push(<span key="date">{date}</span>)

  return (
    <article
      ref={ref}
      className={'share-page' + (page.mode === 'single' ? ' share-page-single' : '') + (include.page ? '' : ' hide-page')}
      style={{
        ...palette,
        width: page.width,
        ...(page.mode === 'split' ? { height: page.height } : null),
      }}
      aria-label={labels.excerpt}
    >
      <header className="share-page-header">
        <div className="share-brand-row">
          <span className="share-brand">
            <PhanerisSymbol className="share-brand-mark" />
            <strong>PHANERIS</strong>
          </span>
          <span>{labels.excerpt}</span>
        </div>
        <div className="share-rule" aria-hidden="true" />
        <h1 className="share-title">{title}</h1>
        {meta.length > 0 && <div className="share-page-meta">{meta}</div>}
      </header>
      <main data-share-content>
        <StaticMarkdownContext.Provider value={true}>
          <ShikiThemeProvider shikiTheme="github-light">
            {messages.map((message, index) => {
              const previous = messages[index - 1]
              const gap = previous ? message.position - previous.position - 1 : 0
              return (
                <section
                  key={message.id}
                  data-share-message={message.id}
                  data-share-role={message.role}
                  data-share-gap={gap > 0 ? 'true' : 'false'}
                >
                  {gap > 0 && <div className="share-gap" data-share-gap>{labels.omitted(gap)}</div>}
                  <div className={'share-message ' + (message.role === 'user' ? 'share-question' : '')}>
                    <div className="share-role" data-share-role-label>
                      <span>{message.role === 'user' ? labels.question : labels.answer}</span>
                      {include.time && <time className="share-time">{formatTime(message.timestamp)}</time>}
                    </div>
                    <Markdown className="share-markdown" mode="minimal" collapsible={false}>{message.content}</Markdown>
                  </div>
                </section>
              )
            })}
          </ShikiThemeProvider>
        </StaticMarkdownContext.Provider>
      </main>
      <footer className="share-page-footer">
        <span>{labels.exportedBy}</span>
        <span data-share-page-number />
      </footer>
    </article>
  )
})
ShareTemplate.displayName = 'ShareTemplate'
