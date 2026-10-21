/**
 * One row in the transcript. Extracted from ChatDisplay (2,306 lines) because it
 * is the component the memo comparator exists for: during streaming the whole
 * list re-renders on every delta, and only an unchanged, non-streaming message
 * may skip it.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../../shared/types'
import { UserMessageBubble } from '@phaneris/ui'
import { AlertTriangle, CheckCircle2, CircleAlert, ExternalLink, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThinkingIndicator } from '@phaneris/ui'
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from '@/components/markdown'
import { ErrorMessage } from './ChatErrorMessage'

interface MessageBubbleProps {
  message: Message
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  sessionId?: string
  /**
   * Markdown render mode for assistant messages
   * @default 'minimal'
   */
  renderMode?: RenderMode
  /**
   * Callback to pop out message into a separate window
   */
  onPopOut?: (message: Message) => void
  /** Compact mode - reduces padding for popover embedding */
  compactMode?: boolean
  /** Callback to resend the user message that preceded an error */
  onRetry?: () => void
  onReconcileModel?: (message: Message) => void
}

export function MessageBubble({
  message,
  onOpenFile,
  onOpenUrl,
  sessionId,
  renderMode = 'minimal',
  onPopOut,
  compactMode,
  onRetry,
  onReconcileModel,
}: MessageBubbleProps) {
  const { t } = useTranslation()

  // === USER MESSAGE: Right-aligned bubble with attachments above ===
  if (message.role === 'user') {
    return (
      <UserMessageBubble
        content={message.content}
        attachments={message.attachments}
        badges={message.badges}
        isPending={message.isPending}
        isQueued={message.isQueued}
        inputReception={message.inputReception}
        onUrlClick={onOpenUrl}
        onFileClick={onOpenFile}
        compactMode={compactMode}
      />
    )
  }

  // === ASSISTANT MESSAGE: Left-aligned gray bubble with markdown rendering ===
  if (message.role === 'assistant') {
    return (
      <div className="flex justify-start group">
        <div className="relative max-w-[90%] bg-background shadow-minimal rounded-shape-lg pl-6 pr-4 py-3 break-words min-w-0 select-text">
          {/* Pop-out button - visible on hover */}
          {onPopOut && !message.isStreaming && (
            <button
              onClick={() => onPopOut(message)}
              data-touch-reveal="true"
              className="craft-row-actions absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-foreground/5"
              title={t("sidebarMenu.openInNewWindow")}
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
          {/* Use StreamingMarkdown for block-level memoization during streaming.
              Both branches carry the same reading class so the transcript does
              not resize when a streamed answer settles. */}
          {message.isStreaming ? (
            <StreamingMarkdown
              content={message.content}
              isStreaming={true}
              mode={renderMode}
              className="text-reading"
              onUrlClick={onOpenUrl}
              onFileClick={onOpenFile}
            />
          ) : (
            <CollapsibleMarkdownProvider>
              <Markdown
                mode={renderMode}
                onUrlClick={onOpenUrl}
                onFileClick={onOpenFile}
                id={message.id}
                className="text-reading"
                collapsible
              >
                {message.content}
              </Markdown>
            </CollapsibleMarkdownProvider>
          )}
        </div>
      </div>
    )
  }

  // === ERROR MESSAGE: Red bordered bubble with warning icon and collapsible details ===
  if (message.role === 'error') {
    return <ErrorMessage message={message} onOpenUrl={onOpenUrl} sessionId={sessionId} onRetry={onRetry} />
  }

  // === STATUS MESSAGE: Matches ProcessingIndicator layout for visual consistency ===
  if (message.role === 'status') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 -mb-1 text-body text-muted-foreground">
        {/* Spinner in same location as TurnCard chevron */}
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <ThinkingIndicator className="size-3" />
        </div>
        <span>{message.content}</span>
      </div>
    )
  }

  // === INFO MESSAGE: Icon and color based on level ===
  if (message.role === 'info') {
    // Compaction complete message - render as horizontal rule with centered label
    // This persists after reload to show where context was compacted
    if (message.statusType === 'compaction_complete') {
      return (
        <div className="flex items-center gap-3 my-12 px-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-body text-text-secondary select-none">
            Conversation Compacted
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )
    }

    const level = message.infoLevel || 'info'
    const config = {
      info: { icon: Info, className: 'text-muted-foreground' },
      warning: { icon: AlertTriangle, className: 'text-info' },
      error: { icon: CircleAlert, className: 'text-destructive' },
      success: { icon: CheckCircle2, className: 'text-success' },
    }[level]
    const Icon = config.icon

    return (
      <div className={cn('flex items-center gap-2 px-3 py-1 text-body select-none', config.className)}>
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <Icon className="w-3 h-3" />
        </div>
        <span>{message.content}</span>
      </div>
    )
  }

  // === WARNING MESSAGE: Info themed bubble ===
  if (message.role === 'warning') {
    return (
      <div className="flex justify-start">
        <div className="craft-bubble bg-info/10 rounded-shape-lg pl-5 pr-4 pt-2 pb-2.5 break-words select-none">
          <div className="text-meta text-info-text mb-0.5 font-semibold">
            Warning
          </div>
          <p className="text-body text-info">{message.content}</p>
          {onReconcileModel && message.durableOperationId && (
            <button
              className="craft-control mt-2 rounded border border-info/30 px-2 py-1 text-meta text-info hover:border-info/60"
              onClick={() => onReconcileModel(message)}
            >
              {t('recovery.model.review')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return null
}

/**
 * MemoizedMessageBubble - Prevents re-renders of non-streaming messages
 *
 * During streaming, the entire message list gets updated on each delta.
 * This wrapper skips re-renders for messages that haven't changed,
 * significantly improving performance for long conversations.
 */
export const MemoizedMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Always re-render streaming messages (content is changing)
  if (prev.message.isStreaming || next.message.isStreaming) {
    return false
  }
  // Skip re-render if key props unchanged
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.role === next.message.role &&
    prev.sessionId === next.sessionId &&
    prev.compactMode === next.compactMode
  )
})
