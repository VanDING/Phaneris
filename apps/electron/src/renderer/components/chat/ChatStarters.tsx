/**
 * ChatStarters — the workspace's user-defined prompt chips.
 *
 * Shown on the new-chat screen only: a starter prefills and sends one message, so
 * it belongs where a first message would be typed. Clicking one behaves exactly
 * like typing its prompt: mentioned sources are enabled first and mentioned
 * skills are handed to the send call, which is the same pair of channels the
 * composer's @-mentions use.
 *
 * Rendering is deliberately plain (one row of chips, no new surface or state):
 * the chips sit above the composer and disappear as soon as the session has a
 * message, so nothing here competes with the transcript.
 */

import * as React from 'react'
import { Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatStarter } from '@phaneris/shared/workspaces/chat-starters'

export interface ChatStartersProps {
  starters: readonly ChatStarter[]
  /** Disabled while the composer cannot send (no connection, streaming, …). */
  disabled?: boolean
  onSelect: (starter: ChatStarter) => void
  className?: string
}

export const ChatStarters = React.memo(function ChatStarters({
  starters,
  disabled = false,
  onSelect,
  className,
}: ChatStartersProps) {
  if (starters.length === 0) return null
  return (
    <div
      className={cn('flex flex-wrap items-center justify-center gap-2 px-4 pb-2', className)}
      data-testid="chat-starters"
      data-chat-starter-count={starters.length}
    >
      {starters.map((starter, index) => (
        <Button
          key={`${starter.label}:${index}`}
          type="button"
          variant="secondary"
          size="sm"
          data-testid="chat-starter"
          data-chat-starter-index={index}
          disabled={disabled}
          title={starter.prompt}
          onClick={() => onSelect(starter)}
          className={cn('h-auto max-w-[16rem] gap-1.5 rounded-shape-lg px-3 py-1.5 text-body')}
        >
          <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{starter.label}</span>
        </Button>
      ))}
    </div>
  )
})
