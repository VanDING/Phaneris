/**
 * UI primitives computed-style fixture.
 *
 * Renders the shipped Button / Badge / MetadataBadge through the real host
 * stylesheet so `ui-primitives-workflow.ts` can assert what the browser actually
 * paints — not what the class string says. The 2026-10-21 audit found the two
 * diverging: `cn()` ate the font-size tier, so a Badge rendered at 15px while its
 * source said `text-meta` (11px).
 *
 * Every case is a data attribute the workflow reads back:
 *   [data-case]        stable id
 *   data-tier          contract tier the element must paint
 *   data-control       contract control height (px), or "auto"
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MetadataBadge } from '@/components/ui/metadata-badge'
import { cn } from '@/lib/utils'

declare global {
  interface Window { __uiPrimitives?: { ready: boolean } }
}

const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('ui-primitives fixture requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

// `?still=1` freezes transitions and animations so a theme toggle cannot be
// measured mid-interpolation. The workflow asserts steady-state computed values;
// motion has its own budget in the long-session workflow.
if (new URLSearchParams(location.search).has('still')) {
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'
  document.head.append(freeze)
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
    <h2 className="text-label text-text-secondary" style={{ margin: 0 }}>{title}</h2>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>{children}</div>
  </section>
)

function Matrix() {
  return (
    <div className="bg-background text-foreground" style={{ minHeight: '100vh' }}>
      <Section title="Button sizes">
        <Button data-case="button-default" data-tier="body" data-control="34">Default</Button>
        <Button size="xs" data-case="button-xs" data-tier="meta" data-control="22">XS</Button>
        <Button size="compact" data-case="button-compact" data-tier="label" data-control="26">Compact</Button>
        <Button size="sm" data-case="button-sm" data-tier="meta" data-control="30">Small</Button>
        <Button size="lg" data-case="button-lg" data-tier="body" data-control="38">Large</Button>
        <Button size="icon" aria-label="Icon" data-case="button-icon" data-control="34">#</Button>
      </Section>
      <Section title="Filled small button (contrast case)">
        <Button size="sm" data-case="button-sm-filled">Filled small</Button>
        <Button size="xs" variant="destructive" data-case="button-xs-destructive">Destructive</Button>
      </Section>
      <Section title="Badges">
        <Badge data-case="badge-default" data-tier="meta" data-control="auto">Badge</Badge>
        <Badge variant="secondary" data-case="badge-secondary" data-tier="meta" data-control="auto">Secondary</Badge>
        <MetadataBadge label="Execute" value="Todo" data-case="metadata-badge" data-tier="meta" data-control="30" />
      </Section>
      <Section title="Tier vs colour (merge layer)">
        <div data-case="probe-meta-foreground" data-tier="meta" className={cn('text-meta text-foreground')}>meta on foreground</div>
        <div data-case="probe-micro-info" data-tier="micro" className={cn('text-micro text-info-text')}>micro on info</div>
        <div data-case="probe-body-background" data-tier="body" className={cn('text-body text-background')}>body on background</div>
      </Section>
      <Section title="Hand-written control (not a Button)">
        <button type="button" className="craft-control h-control-xs px-2 text-meta"
          data-case="craft-control-xs" data-tier="meta">Native XS</button>
      </Section>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Matrix />)
requestAnimationFrame(() => requestAnimationFrame(() => {
  window.__uiPrimitives = { ready: true }
}))
