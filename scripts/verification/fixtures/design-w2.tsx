/**
 * W2 convergence fixture.
 *
 * Renders the real `Button` and `Input` plus probes for the four properties
 * wave 2 unified: the type scale (contract tiers vs Tailwind's rem defaults),
 * control geometry under `--ui-scale`, icon stroke weight, and the status
 * tokens that replaced raw palette hues.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('design-w2 fixture requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

function Probes() {
  return (
    <div data-probe="canvas" className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-[460px] space-y-4 pt-6">
        {/* Type scale: a contract tier, a leftover default-scale class, real prose. */}
        <p data-probe="type-meta" className="text-meta">Timestamps and counts</p>
        <p data-probe="type-body" className="text-body">Body copy</p>
        <p data-probe="type-default-sm" className="text-sm">Leftover default scale</p>
        <p data-probe="type-reading" className="text-reading">Reading column prose</p>

        {/* Control geometry. */}
        <Button data-probe="button">Primary action</Button>
        <Input data-probe="input" placeholder="Field" />
        <div data-probe="icon-button" data-slot="button" className="craft-icon-button size-control-lg inline-flex items-center justify-center text-text-secondary">
          <Sparkles className="size-4" />
        </div>

        {/* Icon stroke: Lucide vs a hand-written currentColor glyph. */}
        <Sparkles data-probe="icon-lucide" className="size-5" />
        <svg data-probe="icon-inline" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-text-secondary">
          <path d="M4 12h16M12 4v16" />
        </svg>

        {/* Status tokens replacing raw palette hues. */}
        <div className="flex flex-wrap gap-2">
          <span data-probe="chip-success" className="rounded-shape-sm bg-success/10 px-2 py-0.5 text-meta text-success-text">Done</span>
          <span data-probe="chip-info" className="rounded-shape-sm bg-info/10 px-2 py-0.5 text-meta text-info-text">Running</span>
          <span data-probe="chip-danger" className="rounded-shape-sm bg-destructive/10 px-2 py-0.5 text-meta text-destructive-text">Failed</span>
        </div>
        <span data-probe="solid-accent" className="rounded-shape-sm bg-accent px-2 py-1 text-label text-on-accent">Solid accent</span>
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
    designW2: { setUiScale: (scale: number) => void; setDark: (dark: boolean) => void; ready: true }
  }
}
window.designW2 = {
  setUiScale: (scale: number) => { document.documentElement.style.setProperty('--ui-scale', String(scale)) },
  setDark: (dark: boolean) => { document.documentElement.classList.toggle('dark', dark) },
  ready: true,
}
