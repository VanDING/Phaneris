import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import './share-selection.css'

/** Optional desktop selection layer; viewers keep the original message surface. */
export const ShareSelectionContext = React.createContext<{
  eligible: ReadonlySet<string>
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
} | null>(null)

export function ShareSelectableMessage({ messageId, messageRole, content, className, children }: {
  messageId?: string
  messageRole: 'user' | 'assistant'
  content: string
  className?: string
  children: React.ReactNode
}) {
  const selection = React.useContext(ShareSelectionContext)
  const { t } = useTranslation()
  const selectable = !!messageId && !!selection?.eligible.has(messageId)
  return <div className={cn('share-selection-shell', selectable && 'is-selectable')}
    data-share-select-id={selectable ? messageId : undefined}
    data-share-message-role={messageRole}
    data-share-selected={selectable ? selection!.selected.has(messageId) : undefined}>
    {selectable && <div className="share-selection-gutter"><input type="checkbox" className="share-inline-check craft-control"
      aria-label={t(messageRole === 'user' ? 'chat.imageShare.question' : 'chat.imageShare.answer') + ': ' + content.slice(0, 80)}
      checked={selection!.selected.has(messageId)} onChange={() => selection!.onToggle(messageId)} /></div>}
    <div className="share-selection-content"><div className={className}>{children}</div></div>
  </div>
}
