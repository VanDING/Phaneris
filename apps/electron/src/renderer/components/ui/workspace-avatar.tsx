/**
 * WorkspaceAvatar - Thin wrapper around CrossfadeAvatar for workspace icons.
 *
 * When no icon is set, renders a deterministic colored initial-letter fallback
 * derived from the workspace ID (so the same workspace always gets the same
 * color across sessions and across surfaces).
 *
 * Sizing/shape is fully controlled by `className` (e.g. `h-4 w-4 rounded-full`).
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { CrossfadeAvatar } from './avatar'
import { cn } from '@/lib/utils'
import { workspaceAvatarColorsAtom } from '@/atoms/workspace-avatar-colors'

function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
  }
  return Math.abs(hash)
}

function getWorkspaceHue(id: string): number {
  return hashString(id) % 360
}

interface WorkspaceAvatarProps {
  /** Workspace id. If omitted, the fallback uses a neutral muted background. */
  workspaceId?: string
  workspaceName?: string
  src?: string | null
  className?: string
  /** Override font size for the initial letter (default 10px micro tier). */
  fallbackClassName?: string
  /**
   * Render the fallback as a plain coloured disc, without the initial letter.
   *
   * For contexts that already spell the workspace name out beside the avatar. Two
   * reasons: at 16px the 10px initial is not legible anyway, and the letter is a
   * *text node*, so it becomes visible text inside a labelled control whose
   * accessible name is the name — `label-content-name-mismatch` flags exactly that,
   * once per surface, because the topbar switcher is on every surface.
   */
  showInitial?: boolean
}

export function WorkspaceAvatar({
  workspaceId,
  workspaceName,
  src,
  className,
  fallbackClassName,
  showInitial = true,
}: WorkspaceAvatarProps) {
  const colorOverrides = useAtomValue(workspaceAvatarColorsAtom)
  const initial = (workspaceName?.trim().charAt(0) || 'W').toUpperCase()
  const hasId = !!workspaceId
  const override = hasId ? colorOverrides[workspaceId!] : undefined
  const bgStyle = hasId
    ? {
        backgroundColor:
          override || `hsl(${getWorkspaceHue(workspaceId!)}, 45%, 52%)`,
      }
    : undefined

  return (
    <CrossfadeAvatar
      src={src ?? undefined}
      alt={workspaceName}
      className={className}
      fallbackClassName={cn('text-micro', !hasId && 'bg-muted', fallbackClassName)}
      fallback={
        hasId ? (
          <div
            className="flex h-full w-full items-center justify-center font-medium text-white"
            style={bgStyle}
          >
            {showInitial ? initial : null}
          </div>
        ) : showInitial ? (
          initial
        ) : null
      }
    />
  )
}
