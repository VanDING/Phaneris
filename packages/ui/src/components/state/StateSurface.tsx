/**
 * StateSurface — one primitive for empty, loading, error, partial and denied
 * surfaces. Callers supply content and recovery actions; the shape, spacing and
 * semantics stay identical across panels.
 */
import * as React from 'react'
import { cn } from '../../lib/utils'

export type StateVariant = 'empty' | 'loading' | 'error' | 'partial' | 'denied'

export interface StateSurfaceProps {
  variant?: StateVariant
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  /** Dense panels (sidebars, popovers) use the compact rhythm. */
  compact?: boolean
  className?: string
}

const ROLE: Record<StateVariant, 'status' | 'alert' | undefined> = {
  empty: undefined,
  loading: 'status',
  error: 'alert',
  partial: 'status',
  denied: 'alert',
}

export function StateSurface({
  variant = 'empty',
  title,
  description,
  icon,
  actions,
  compact = false,
  className,
}: StateSurfaceProps) {
  return (
    <div
      role={ROLE[variant]}
      aria-live={variant === 'loading' ? 'polite' : undefined}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-7 py-10',
        className,
      )}
    >
      {icon && (
        <div className={cn(
          'mb-1 flex items-center justify-center rounded-card bg-foreground/[0.035] text-text-tertiary',
          compact ? 'h-9 w-9' : 'h-12 w-12',
        )}>
          {icon}
        </div>
      )}
      <p className={cn('font-medium text-text-primary', compact ? 'text-label' : 'text-body')}>{title}</p>
      {description && (
        <p className={cn('max-w-[42ch] text-text-secondary', compact ? 'text-meta' : 'text-label')}>
          {description}
        </p>
      )}
      {actions && <div className={cn('flex items-center gap-2', compact ? 'mt-2' : 'mt-3')}>{actions}</div>}
    </div>
  )
}

export function EmptyState(props: Omit<StateSurfaceProps, 'variant'>) {
  return <StateSurface {...props} variant="empty" />
}

export function ErrorState(props: Omit<StateSurfaceProps, 'variant'>) {
  return <StateSurface {...props} variant="error" />
}

export type BannerTone = 'error' | 'warning' | 'info'

export interface ErrorBannerProps {
  tone?: BannerTone
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  /** Long, multi-line diagnostics should wrap instead of truncating. */
  wrap?: boolean
  className?: string
}

const BANNER_TONE: Record<BannerTone, string> = {
  error: 'bg-destructive/10 text-destructive',
  warning: 'bg-info/10 text-info-text',
  info: 'bg-accent/10 text-accent-text',
}

/** One banner primitive for transport, overlay and inline failures. No border:
 *  the tint carries the state, keeping the single-border rule intact. */
export function ErrorBanner({ tone = 'error', title, description, action, wrap = false, className }: ErrorBannerProps) {
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn('flex items-center justify-between gap-3 rounded-shape-lg px-4 py-2', BANNER_TONE[tone], className)}
    >
      <div className="min-w-0">
        <p className="truncate text-label font-medium">{title}</p>
        {description && (
          <p className={cn('text-meta opacity-90', wrap ? 'whitespace-pre-wrap break-words font-mono' : 'truncate')}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
