import { ArrowUpRight, Brain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@phaneris/core'
import type { ActivityItem } from './TurnCard'

export function thinkingActivities(message: Message): ActivityItem[] {
  return (message.outputBlocks ?? []).flatMap((block, index) => block.type === 'thinking' && block.content?.trim() ? [{
    id: `${message.turnId ?? message.id}:thinking:${block.index ?? index}`, messageId: message.id,
    type: 'thinking' as const, displayName: 'Thinking',
    status: message.isPending && block.isStreaming ? 'running' as const : 'completed' as const,
    content: block.content, timestamp: message.timestamp, parentId: message.parentToolUseId,
  }] : [])
}

/** Same pop-out action as other activities; content never expands inside the list. */
export function ThinkingActivityRow({ activity, onOpenDetails }: { activity: ActivityItem; onOpenDetails?: () => void }) {
  const { t } = useTranslation()
  return <div data-activity-type="thinking" className="flex min-w-0 items-stretch">
    <button type="button" disabled={!onOpenDetails} onClick={onOpenDetails}
      className="craft-row-focus group/row flex min-w-0 flex-1 items-center gap-2 py-[var(--theme-activity-row-padding-y)] text-body text-text-secondary"
      aria-haspopup="dialog" aria-label={t('turnCard.viewThinking')}>
      <Brain className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left group-hover/row:underline">{activity.content?.slice(0, 500).replace(/\s+/g, ' ')}</span>
      <ArrowUpRight aria-hidden="true" className="size-3 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100" />
    </button>
  </div>
}
