/**
 * The chat's error row.
 *
 * Extracted from ChatDisplay, where it was the last self-contained component in
 * a 2,500-line file: it owns one piece of state (are the technical details
 * open), routes the message's actions through `error-message-actions`, and
 * renders nothing else. The tinted surface (3% destructive fill plus a tinted
 * shadow) is the error language the rest of the app copies, so it lives with a
 * name instead of as an inline block.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { InlineExpand } from '@phaneris/ui'
import type { Message } from '../../../shared/types'
import { handleErrorMessageAction } from './error-message-actions'

export function ErrorMessage({ message, onOpenUrl, sessionId, onRetry }: {
  message: Message
  onOpenUrl?: (url: string) => void
  sessionId?: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const hasDetails = (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const actions = message.errorActions?.filter(a => {
    if (a.action === 'open_url') return !!a.url && !!onOpenUrl
    return true
  })

  return (
    <div className="flex justify-start mt-4">
      {/* Subtle bg (3% opacity) + tinted shadow for softer error appearance */}
      <div
        className="craft-bubble bg-destructive/5 shadow-tinted rounded-shape-lg pl-5 pr-4 pt-2 pb-2.5 break-words"
        style={{
          '--shadow-color': 'var(--destructive)',
        } as React.CSSProperties}
      >
        <div className="text-meta text-destructive-text mb-0.5 font-semibold">
          {message.errorTitle || t('common.error')}
        </div>
        <p className="text-body text-destructive">{message.content}</p>

        {/* Action buttons */}
        {actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {actions.map((action) => (
              <button
                key={action.key}
                onClick={() => {
                  handleErrorMessageAction(action, {
                    sessionId,
                    onOpenUrl,
                    onRetry,
                  })
                }}
                className="craft-control text-meta px-2 py-0.5 rounded border border-destructive/20 text-destructive-text hover:text-destructive hover:border-destructive/40 transition-colors"
              >
                {action.label}{action.action === 'open_url' ? ' ↗' : ''}
              </button>
            ))}
          </div>
        )}

        {/* Collapsible Details Toggle */}
        {hasDetails && (
          <div className="mt-2">
            <button
              onClick={() => setDetailsOpen(!detailsOpen)}
              className="craft-control flex items-center gap-1 text-meta text-destructive-text hover:text-destructive transition-colors"
            >
              {detailsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{detailsOpen ? t('chat.hideTechnicalDetails') : t('chat.showTechnicalDetails')}</span>
            </button>

            <InlineExpand isOpen={detailsOpen} clip="clip">
              <div className="mt-2 pt-2 border-t border-destructive/20 text-meta text-destructive-text font-mono space-y-0.5">
                {message.errorDetails?.map((detail, i) => (
                  <div key={i}>{detail}</div>
                ))}
                {message.errorOriginal && !message.errorDetails?.some(d => d.includes('Raw error:')) && (
                  <div className="mt-1">Raw: {message.errorOriginal.slice(0, 200)}{message.errorOriginal.length > 200 ? '...' : ''}</div>
                )}
              </div>
            </InlineExpand>
          </div>
        )}
      </div>
    </div>
  )
}
