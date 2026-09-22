import * as React from 'react'
import * as Sentry from '@sentry/electron/renderer'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SurfaceErrorBoundaryProps {
  /** Identifies the surface in logs and Sentry (for example `projects/gantt`). */
  surface: string
  /** Changing this value clears a caught error, e.g. when the view changes. */
  resetKey?: string
  children: React.ReactNode
}

interface SurfaceErrorBoundaryState {
  hasError: boolean
  /** Kept so a dev build can show what actually failed instead of a generic note. */
  errorMessage?: string
}

/**
 * Contains a crash to one Primary Surface projection.
 *
 * Without this, a render error anywhere inside a projection bubbles to the root
 * Sentry boundary and replaces the entire application shell with the crash
 * fallback — the window looks frozen because no control responds. A projection
 * that cannot render should degrade to a message inside its own panel so the
 * navigation, session list and chat stay usable.
 */
export class SurfaceErrorBoundary extends React.Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  state: SurfaceErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): SurfaceErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[SurfaceErrorBoundary] ${this.props.surface} crashed:`, error)
    this.setState({ errorMessage: error.message })
    Sentry.captureException(error, {
      tags: { errorSource: 'surface', surface: this.props.surface },
      extra: { componentStack: info.componentStack },
    })
  }

  componentDidUpdate(prevProps: SurfaceErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: undefined })
    }
  }

  private retry = () => {
    this.setState({ hasError: false, errorMessage: undefined })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return <SurfaceErrorFallback surface={this.props.surface} errorMessage={this.state.errorMessage} onRetry={this.retry} />
  }
}

function SurfaceErrorFallback({
  surface,
  errorMessage,
  onRetry,
}: {
  surface: string
  errorMessage?: string
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-xl border border-destructive/20 bg-background px-5 py-5 text-center">
        <div className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{t('errors.surfaceFailedTitle')}</p>
        <p className="mt-1 text-xs text-foreground/60">{t('errors.surfaceFailedDescription')}</p>
        <p className="mt-2 text-[11px] text-foreground/35">{surface}</p>
        {errorMessage && (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-foreground/[0.04] p-2 text-left text-[10px] text-destructive/80">
            {errorMessage}
          </pre>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {t('common.retry')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => window.location.reload()}>
            {t('common.reload')}
          </Button>
        </div>
      </div>
    </div>
  )
}
