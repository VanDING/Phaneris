/**
 * W1 design-regression fixture.
 *
 * Mounts the real `SessionSearchHeader` (the focus gap the 2026-10-20 review
 * found) plus probes for the three properties the wave changed: the text-tone
 * ladder, the two-state toggle, and the motion vocabulary. Every colour is read
 * from the stylesheet at runtime, so the assertions test the shipped CSS, not a
 * restatement of it in the test.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ImageIcon } from 'lucide-react'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

// The workflow passes the host stylesheet as a query parameter; the fixture owns
// loading it so the measured colours are the shipped ones, not a copy.
const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('design-w1 fixture requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

function Probes() {
  const [query, setQuery] = React.useState('')
  return (
    <div data-probe="canvas" className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-[420px] pt-6 space-y-4">
        {/* The component under repair. */}
        <div data-probe="header">
          <SessionSearchHeader
            searchQuery={query}
            onSearchChange={setQuery}
            onSearchClose={() => setQuery('')}
            resultCount={3}
          />
        </div>

        {/* Text-tone ladder, on the canvas and on a sunken surface. */}
        <p data-probe="secondary-on-canvas" className="text-label text-text-secondary">Timestamps and counts</p>
        <div data-probe="sunken" className="bg-muted rounded-shape-lg p-3">
          <p data-probe="secondary-on-muted" className="text-label text-text-secondary">Muted ink on a well</p>
          <p data-probe="micro-on-muted" className="text-micro text-text-secondary">Attached file.txt</p>
        </div>
        <p data-probe="status-on-canvas" className="text-label text-destructive-text">Search unavailable</p>
        {/* The one sanctioned alpha text token: WCAG exempts disabled controls.
            Excluded from the "no translucent text" scan by data-exempt. */}
        <p data-probe="disabled-on-canvas" data-exempt="disabled" className="text-label" style={{ color: 'var(--text-disabled)' }}>
          Disabled control
        </p>
        <input
          data-probe="placeholder"
          className="craft-control craft-field-input w-full rounded-shape-md px-3 h-8 text-label placeholder:text-text-secondary"
          placeholder="Placeholder tone"
        />

        {/* Two-state toggle: state must survive the AA floor. */}
        <div className="flex items-center gap-4">
          <span data-probe="toggle-on" className="inline-flex items-center justify-center p-2">
            <ImageIcon data-probe="toggle-on-icon" className="h-3.5 w-3.5 text-foreground" />
          </span>
          <span data-probe="toggle-off" className="inline-flex items-center justify-center p-2">
            <ImageIcon data-probe="toggle-off-icon" className="h-3.5 w-3.5 text-text-secondary" />
          </span>
        </div>

        {/* Motion vocabulary: the surviving entrance must exist, the removed
            ones must not be declared anywhere. */}
        <div data-probe="motion-decay" className="animate-check-decay text-label">Copied</div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <Probes />
  </I18nextProvider>,
)

declare global {
  interface Window {
    designW1: { setDark: (dark: boolean) => void; ready: true }
  }
}
window.designW1 = {
  setDark: (dark: boolean) => { document.documentElement.classList.toggle('dark', dark) },
  ready: true,
}
