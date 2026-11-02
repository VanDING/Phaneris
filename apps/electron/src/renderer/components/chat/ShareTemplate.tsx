import * as React from 'react'
import { Markdown, ShikiThemeProvider, StaticMarkdownContext } from '@phaneris/ui'
import { DEFAULT_THEME } from '@phaneris/shared/config/theme'
import type { ShareMessage } from '@/lib/share-messages'
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
  selected: string
  question: string
  answer: string
  omitted: string
}

export const ShareTemplate = React.forwardRef<HTMLElement, {
  title: string
  messages: readonly ShareMessage[]
  labels: ShareTemplateLabels
}>(({ title, messages, labels }, ref) => (
  <article ref={ref} className="share-page" style={palette} aria-label={labels.excerpt}>
    <header className="share-page-header">
      <div className="share-brand-row"><strong>PHANERIS</strong><span>{labels.excerpt}</span></div>
      <h2 className="share-title">{title}</h2>
      <div className="share-page-meta">{labels.selected}</div>
    </header>
    <main data-share-content>
      <StaticMarkdownContext.Provider value={true}>
        <ShikiThemeProvider shikiTheme="github-light">
          {messages.map((message, index) => (
            <section key={message.id} data-share-message={message.id} data-share-role={message.role}
              data-share-gap={index > 0 && message.position - messages[index - 1]!.position > 1 ? 'true' : 'false'}>
              {index > 0 && message.position - messages[index - 1]!.position > 1 && (
                <div className="share-gap" data-share-gap>{labels.omitted}</div>
              )}
              <div className={'share-message ' + (message.role === 'user' ? 'share-question' : '')}>
                <div className="share-role" data-share-role-label>{message.role === 'user' ? labels.question : labels.answer}</div>
                <Markdown className="share-markdown" mode="minimal" collapsible={false}>{message.content}</Markdown>
              </div>
            </section>
          ))}
        </ShikiThemeProvider>
      </StaticMarkdownContext.Provider>
    </main>
    <footer className="share-page-footer"><span>Phaneris</span><span data-share-page-number /></footer>
  </article>
))
ShareTemplate.displayName = 'ShareTemplate'
