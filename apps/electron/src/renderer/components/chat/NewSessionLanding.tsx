import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { PhanerisSymbol } from '@/components/icons/PhanerisSymbol'
import { cn } from '@/lib/utils'

/**
 * NewSessionLanding — the brand surface shown in a chat session with no messages.
 *
 * Two elements only: the Phaneris mark and one line of copy. No wordmark (the
 * product name already appears in the sidebar, splash screen and window title),
 * and nothing read out about the session — the composer's own
 * folder/sources badges already report that state one row below.
 *
 * Motion is pure CSS (`.craft-hero-*` in renderer/index.css): the mark's outline
 * draws itself, the fill inks in behind it, the line of copy rises into place,
 * and both then breathe together. Nothing here runs per frame, so the streaming
 * and background-task re-renders that drive ChatDisplay never re-trigger it.
 * `packages/ui/src/styles/motion.css` collapses every animation to 1ms and one
 * iteration under `prefers-reduced-motion`, which lands on the settled state.
 *
 * Callers must gate on: no messages, not loading, no load error, not compact.
 */
export const NewSessionLanding = React.memo(function NewSessionLanding() {
  const { t } = useTranslation()

  return (
    <div
      className="pointer-events-none col-start-1 row-start-1 z-10 flex select-none flex-col items-center justify-center px-6"
      data-testid="new-session-landing"
    >
      <div className="flex flex-col items-center">
        {/* `.logo-mark` carries the shared draw-then-ink entrance (index.css);
            `craft-hero-mark` adds the slow breath on top of it.
            tone="accent" shades the five faces from the theme accent, so the mark
            has depth AND follows whatever theme is selected — a fixed-colour
            lockup here read as a stuck purple logo under every non-purple theme. */}
        <PhanerisSymbol tone="accent" className="logo-mark craft-hero-mark logo-relief w-[118px] text-accent" />
        <p
          className={cn(
            'craft-hero-copy mt-[22px] max-w-[24rem] text-center',
            // The app sets a negative base letter-spacing (-0.006em, tuned for
            // Latin UI text). The slogan is set at display size and is Chinese in
            // the zh-Hans locale, where the marks need room rather than tightening.
            'text-[17px] font-normal leading-normal tracking-[0.02em] text-muted-foreground',
          )}
        >
          {t('newSession.slogan')}
        </p>
      </div>
    </div>
  )
})
