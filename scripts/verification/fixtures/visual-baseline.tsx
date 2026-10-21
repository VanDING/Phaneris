/**
 * Visual baseline fixture.
 *
 * One page, six cells (theme × mode × density), each rendering the same set of
 * stable component specimens: the type ladder, the control family, a status
 * chip row, a message bubble, a menu trigger, an empty state, a loading row and
 * a dialog trigger. The workflow screenshots the page per cell and compares the
 * bytes with a committed baseline.
 *
 * Why a purpose-built page instead of the playground app: a baseline is only
 * useful if the fixture is *stable*. The playground mounts the whole shell with
 * live data; this mounts the primitives with fixed copy, fixed size and no
 * animation, which is exactly what the 2026-10-20 review asked for ("只对组件级
 * 稳定夹具启用，避免整页噪声").
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Check, Search, Sparkles } from 'lucide-react'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { BUILTIN_THEMES, DEFAULT_THEME, resolveTheme, themeDerivedCSS, themeToCSS, type ThemeDensity, type ThemeFile } from '@config/theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileKindIcon } from '@phaneris/ui'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('visual baseline fixture requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

function Specimens() {
  return (
    <div data-baseline-page className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-[560px] space-y-4 p-6">
        <section data-specimen="type" className="space-y-1">
          <p className="text-micro">micro · 10</p>
          <p className="text-meta">meta · 11</p>
          <p className="text-label">label · 12</p>
          <p className="text-body">body · 13</p>
          <p className="text-reading">reading · 14</p>
          <p className="text-title">title · 16</p>
          <p className="text-display">display · 20</p>
        </section>

        <section data-specimen="controls" className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button size="icon" aria-label="Sparkle">
            <Sparkles className="size-4" />
          </Button>
          <Input placeholder="Placeholder" className="w-40" />
          <div className="craft-field-shell relative w-44 rounded-shape-lg bg-muted/50 shadow-minimal">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input readOnly placeholder="Search…" className="h-8 w-full bg-transparent pl-8 pr-2 text-body outline-none" />
          </div>
        </section>

        <section data-specimen="status" className="flex flex-wrap items-center gap-2">
          <span className="rounded-shape-sm bg-success/10 px-2 py-0.5 text-meta text-success-text">Done</span>
          <span className="rounded-shape-sm bg-info/10 px-2 py-0.5 text-meta text-info-text">Running</span>
          <span className="rounded-shape-sm bg-destructive/10 px-2 py-0.5 text-meta text-destructive-text">Failed</span>
          <span className="rounded-shape-sm bg-foreground/[0.06] px-2 py-0.5 text-meta text-text-secondary">Skipped</span>
          <span className="rounded-shape-sm bg-accent px-2 py-0.5 text-meta text-on-accent">Accent</span>
        </section>

        <section data-specimen="file" className="flex items-center gap-3">
          <FileKindIcon name="src/index.ts" className="size-4" />
          <FileKindIcon name="docs/readme.md" className="size-4" />
          <FileKindIcon name="assets" directory className="size-4" />
          <Check className="size-4 text-success-text" />
        </section>

        <section data-specimen="message" className="flex justify-end">
          <div className="max-w-[80%] rounded-bubble bg-user-message-bubble px-3.5 py-2 text-reading">
            Show me the last three failures, with the stack trace collapsed.
          </div>
        </section>

        <section data-specimen="empty" className="flex flex-col items-center gap-2 rounded-shape-lg border border-border/60 px-4 py-6 text-center">
          <Sparkles className="size-6 text-text-secondary" />
          <p className="text-label font-medium">Nothing here yet</p>
          <p className="text-meta text-text-secondary">Start a session to see activity.</p>
        </section>

        {/* Density is only observable where a component consumes the density
            tokens; without this specimen the compact cell is a duplicate of the
            comfortable one and a density regression would be invisible. */}
        <section data-specimen="density" className="overflow-hidden rounded-shape-lg border border-border/60">
          <div className="craft-settings-row craft-settings-padding flex items-center justify-between">
            <span className="text-body">Settings row</span>
            <span className="text-meta text-text-secondary">value</span>
          </div>
          <div className="craft-settings-plain flex items-center justify-between px-4 text-body">
            <span>Plain row</span>
            <span className="text-meta text-text-secondary">value</span>
          </div>
          <div className="craft-menu-item flex items-center px-3 text-body">
            Menu item
          </div>
        </section>

        <section data-specimen="loading" className="flex items-center gap-2 text-body text-text-secondary">
          <span className="craft-button-spinner relative inline-block size-3 text-muted-foreground" />
          <span>Working…</span>
        </section>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <Specimens />
  </I18nextProvider>,
)

declare global {
  interface Window {
    visualBaseline: {
      apply: (themeId: string, mode: 'light' | 'dark', density: ThemeDensity) => void
      ready: true
    }
  }
}

const styleElement = document.createElement('style')
styleElement.id = 'baseline-theme'
document.head.append(styleElement)

window.visualBaseline = {
  apply: (themeId, mode, density) => {
    const file: ThemeFile = (themeId === 'default' ? DEFAULT_THEME : BUILTIN_THEMES[themeId] ?? DEFAULT_THEME) as ThemeFile
    const resolved = resolveTheme(file)
    const dark = mode === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.dataset.themeDepth = (resolved.depth ?? 'elevated')
    // Same recipe the theme provider uses: derived tokens, then the theme's own
    // declarations, then the density the workflow asked for.
    styleElement.textContent = `:root {\n  ${themeDerivedCSS(dark)}\n  ${themeToCSS({ ...resolved, density }, dark)}\n}`
  },
  ready: true,
}
