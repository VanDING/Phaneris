/**
 * OverlayErrorBanner - preview overlay failures.
 *
 * Rendering is owned by the shared ErrorBanner: tinted surface, alert semantics,
 * wrapped diagnostics. No local colors or borders.
 */

import { ErrorBanner } from '../state/StateSurface'

export interface OverlayErrorBannerProps {
  /** Short label describing the error type (e.g. "Write Failed", "Read Failed") */
  label: string
  /** Full error message */
  message: string
}

export function OverlayErrorBanner({ label, message }: OverlayErrorBannerProps) {
  return (
    <div className="w-full max-w-[850px] mx-auto">
      <ErrorBanner tone="error" title={label} description={message} wrap className="shadow-tinted" />
    </div>
  )
}
