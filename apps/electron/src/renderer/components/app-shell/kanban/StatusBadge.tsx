import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/config/session-status-config'

interface StatusBadgeProps {
  status: SessionStatus
  /** Pulse the dot to signal live/active work (gated by the board's live-pulse pref). */
  live?: boolean
  className?: string
}

/**
 * Read-only status pill: colored dot + label, on a faint tint of the status
 * color so the badge carries its own presence. Independent from the board column
 * (a `needs-review` badge can sit in the In Progress column).
 *
 * When `live`, the dot gains a ping ring to signal an in-flight turn.
 *
 * The label is `--text-secondary`, not the status colour. Muted statuses
 * (`foreground/50`) painted their *own* colour as text on a 12% tint of it,
 * measured 3.02:1 — the colour has to mark the row, and the words have to stay
 * readable. The dot keeps the full colour, so nothing is lost visually.
 */
export function StatusBadge({ status, live = false, className }: StatusBadgeProps) {
  const color = status.resolvedColor
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-meta font-medium whitespace-nowrap text-text-secondary',
        className
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {live && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: color }}
            aria-hidden
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      </span>
      {status.label}
    </span>
  )
}
