/** Retained text reader and the tool call's parallel arguments/result sections. */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { Markdown } from '../markdown/Markdown'
import type { ContextContentMode, ContextReadItem } from './RunContextChanges'
import css from './run-view.module.css'

const CONTENT_PREVIEW_CHARS = 6_000

export function ContextEntry({ item, categoryLabel, mode, copied, copyError, previousSeq, requestSeq, embedded, onCopy, onOpenChat, onOpenFile }: {
  item: ContextReadItem
  categoryLabel: string
  mode: ContextContentMode
  copied: boolean
  copyError: boolean
  previousSeq?: number
  requestSeq: number
  embedded?: boolean
  onCopy: (content: string) => void
  onOpenChat?: (messageId: string) => void
  onOpenFile?: (path: string) => void
}) {
  const { t } = useTranslation()
  const [fullContent, setFullContent] = useState(false)
  const tool = item.category === 'tool' || item.category === 'skill'
  const comparing = mode === 'changes' && item.change === 'modified' && item.previousItem !== undefined
  const text = comparing ? item.content : tool ? item.toolResult ?? item.content : item.content
  const before = comparing ? item.previousItem!.content : ''
  const maximumLength = Math.max(text.length, before.length)
  const longContent = maximumLength > CONTENT_PREVIEW_CHARS
  const preview = (value: string) => longContent && !fullContent && value.length > CONTENT_PREVIEW_CHARS ? `${value.slice(0, CONTENT_PREVIEW_CHARS)}…` : value
  const shownText = preview(text)
  const label = item.category === 'system' && item.promptVersion !== undefined
    ? t('run.context.systemPromptVersion', { version: item.promptVersion }) : categoryLabel
  const sectionLabel = comparing ? t('run.context.mode.diff') : tool ? t('run.context.toolResult') : item.category === 'schemas'
    ? t('run.context.toolDescription') : embedded ? t('run.context.contentLabel') : label
  return (
    <article className={css.contextEntry} data-context-item={embedded ? undefined : item.id} data-context-content={item.id} aria-label={item.label || label}>
      {tool && !comparing && <section className={css.contextToolArguments} data-context-arguments>
        <div className={css.entryHeading}>
          <strong>{item.toolName || t('run.context.toolArguments')}</strong>
          <span className={css.muted}>{t('run.context.toolArguments')}</span>
          <span className={`${css.statusBadge} ${item.toolStatus === 'failed' ? css.statusWarning : item.toolStatus === 'succeeded' ? css.statusSuccess : ''}`}>
            <span className={css.statusDot} />{item.toolStatus === 'failed' ? t('run.context.toolFailed') : item.toolStatus === 'succeeded' ? t('run.context.toolSucceeded') : t('run.unknown')}
          </span>
          {item.durationSeconds !== undefined && <span className={`${css.muted} ${css.tabular}`}>{item.durationSeconds.toFixed(2)}s</span>}
        </div>
        {item.toolArguments && Object.keys(item.toolArguments).length > 0 && <dl className={css.contextArguments}>
          {Object.entries(item.toolArguments).map(([key, value]) => <div key={key}>
            <dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</dd>
          </div>)}
        </dl>}
      </section>}
      <section className={css.contextTextSection} data-context-result={tool ? '' : undefined}>
        <div className={css.foldEntryToolbar}>
          <strong>{sectionLabel}</strong>
          <div className={css.foldEntryActions}>
            <span className={css.entryToolbarMeta}>{t('run.context.lineCount', { count: text ? text.split(/\r\n|\r|\n/).length : 0 })}</span>
            {item.change && <span className={`${css.contextChangeTag} ${item.change === 'removed' ? css.changeNegative : css.changePositive}`}>{t(`run.context.change.${item.change}`)}</span>}
            <button type="button" className={`${css.iconButton} craft-control`} onClick={() => onCopy(text)} aria-label={copied ? t('run.context.copied') : t('run.context.copy')}>{copied ? <Check /> : <Copy />}</button>
          </div>
        </div>
        {copyError && <p className={css.miniNote} role="status">{t('run.context.copyFailed')}</p>}
        <div className={css.readerContent}>
          {comparing ? <>
            <p className={css.miniNote}>{t('run.context.diffChanged', { before: item.previousItem!.chars, after: item.chars })}</p>
            <div className={`${css.contextChangeBlock} ${css.contextChangeBefore}`} data-change-before><strong>{t('run.requestNumber', { seq: previousSeq })}</strong><pre>{preview(before)}{item.category === 'schemas' && item.previousItem!.contentHash ? `\n\n${t('run.context.schemaFingerprint')}: ${item.previousItem!.contentHash}` : ''}</pre></div>
            <div className={`${css.contextChangeBlock} ${css.contextChangeAfter}`} data-change-after><strong>{t('run.requestNumber', { seq: requestSeq })}</strong><pre>{shownText}{item.category === 'schemas' && item.contentHash ? `\n\n${t('run.context.schemaFingerprint')}: ${item.contentHash}` : ''}</pre></div>
          </> : (tool && !/^\s*(#{1,6}\s|```|[-*]\s|\d+\.\s|\|)/m.test(shownText)) ? <pre>{shownText}</pre>
              : shownText.trim() ? <Markdown mode="minimal" className={css.contextMarkdown} onFileClick={onOpenFile}>{shownText}</Markdown>
                : <p className={css.miniNote}>{t('run.context.emptyContent')}</p>}
        </div>
        {longContent && <div className={css.contentPreview}>
          {!fullContent && <span className={css.miniNote}>{t('run.context.previewNote', { count: CONTENT_PREVIEW_CHARS.toLocaleString(), total: maximumLength.toLocaleString() })}</span>}
          <button type="button" className={`${css.textButton} craft-control`} aria-expanded={fullContent} onClick={() => setFullContent(value => !value)}>{t(fullContent ? 'run.context.showLess' : 'run.context.showFullContent')}</button>
        </div>}
      </section>
      <div className={css.contextEntryFoot}>
        <span>{t(item.category === 'system' || item.category === 'schemas' ? 'run.requestNumber' : 'run.context.introducedAt', { seq: item.introducedSeq ?? '—' })} · {t('run.context.readOnly')}</span>
        {item.messageId && onOpenChat && <button type="button" className={`${css.quietButton} craft-control`} onClick={() => onOpenChat(item.messageId!)}>{t('trajectory.context.openChat')}</button>}
        {item.filePath && onOpenFile && <button type="button" className={`${css.quietButton} craft-control`} onClick={() => onOpenFile(item.filePath!)}>{t('trajectory.context.openFile')}</button>}
      </div>
      {item.category === 'schemas' && <p className={css.miniNote}>{t('run.context.schemaNote')}</p>}
    </article>
  )
}
