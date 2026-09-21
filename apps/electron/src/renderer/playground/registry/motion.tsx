import * as React from 'react'
import { ActivityStatusIcon, InlineExpand, type ActivityStatus } from '@phaneris/ui'
import { useScrollBehavior } from '@phaneris/ui/scroll-intent'
import { ContentSwap } from '@/components/ui/content-swap'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

/**
 * Motion acceptance surface.
 *
 * Three behaviours that the shared motion rules depend on, driven by hand so
 * both directions and rapid repeated input can be exercised:
 *
 * - inline expand: opens and closes in place, and the layer that is closing
 *   stops accepting input immediately;
 * - same-level swap: the incoming content takes the slot on the same frame the
 *   state changes instead of waiting for the outgoing content;
 * - tool status handoff: the newest status is authoritative while the previous
 *   icon fades underneath, so a fast pending → running → complete run never
 *   shows an empty slot.
 *
 * The Playground's Motion switch (System / Normal / Reduced) covers the same
 * scenarios for the reduced branch — CSS and Motion both follow it.
 */

const STATUSES: ActivityStatus[] = ['pending', 'running', 'completed', 'error']

const EXPAND_ROWS = [
  'read src/renderer/main.tsx',
  'grep "useReducedMotion"',
  'edit TurnCard.tsx',
  'bash bun test',
  'read packages/ui/src/lib/motion.ts',
  'grep "transition-all"',
]

function MotionSample() {
  const [isOpen, setIsOpen] = React.useState(true)
  const [step, setStep] = React.useState(0)
  const [status, setStatus] = React.useState<ActivityStatus>('pending')
  const [isCycling, setIsCycling] = React.useState(false)

  // Rapid, deliberately overlapping status changes — the case that used to pass
  // through a phase where neither icon was on screen.
  React.useEffect(() => {
    if (!isCycling) return
    const timer = window.setInterval(() => {
      setStatus((current) => STATUSES[(STATUSES.indexOf(current) + 1) % STATUSES.length]!)
    }, 160)
    return () => window.clearInterval(timer)
  }, [isCycling])

  return (
    <div className="w-full min-w-0 space-y-6 p-5" data-testid="motion-primitives">
      <section className="space-y-2" data-testid="motion-inline-expand">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Inline expand</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setIsOpen((open) => !open)}>
              {isOpen ? 'Collapse' : 'Expand'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="motion-inline-expand-burst"
              onClick={() => {
                // Rapid reversal: each click must pick up from where the box is.
                for (let index = 0; index < 6; index += 1) {
                  window.setTimeout(() => setIsOpen((open) => !open), index * 40)
                }
              }}
            >
              Burst ×6
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background p-2">
          <InlineExpand isOpen={isOpen}>
            <ul className="space-y-1 p-1 text-xs text-muted-foreground">
              {EXPAND_ROWS.map((row) => (
                <li key={row} className="truncate font-mono">
                  {row}
                </li>
              ))}
            </ul>
          </InlineExpand>
        </div>
      </section>

      <section className="space-y-2" data-testid="motion-content-swap">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Same-level swap</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setStep((value) => value - 1)}>
              Back
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStep((value) => value + 1)}>
              Forward
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="motion-content-swap-burst"
              onClick={() => {
                for (let index = 0; index < 8; index += 1) {
                  window.setTimeout(() => setStep((value) => value + 1), index * 30)
                }
              }}
            >
              Burst ×8
            </Button>
          </div>
        </div>
        {/* The swap pops the outgoing layer out of the flow, so the parent must
            be positioned. */}
        <div className="relative h-[132px] rounded-lg border border-border/60 bg-background p-2">
          <ContentSwap swapKey={step} className="h-full min-h-0">
            <div className="flex h-full flex-col justify-center gap-1 px-1">
              <div className="text-sm font-medium">Step {step}</div>
              <div className="text-xs text-muted-foreground">
                {step % 2 === 0
                  ? 'Even steps explain the entry state.'
                  : 'Odd steps explain the result state.'}
              </div>
              <button
                type="button"
                className="mt-2 w-fit rounded border border-border px-2 py-0.5 text-xs"
                data-testid="motion-swap-inner-button"
              >
                Inside step {step}
              </button>
            </div>
          </ContentSwap>
        </div>
      </section>

      <section className="space-y-2" data-testid="motion-status-icon">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Tool status handoff</h3>
          <div className="flex gap-1">
            {STATUSES.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? 'default' : 'outline'}
                onClick={() => {
                  setIsCycling(false)
                  setStatus(value)
                }}
              >
                {value}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => setIsCycling((value) => !value)}>
              {isCycling ? 'Stop' : 'Cycle 160ms'}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
          <ActivityStatusIcon status={status} />
          <span className={cn('text-[13px] text-muted-foreground')}>Bash · bun test</span>
        </div>
      </section>

      <ScrollIntentSample />
    </div>
  )
}

/**
 * Scroll intent: the same target, reached through the two policies the product
 * uses. `immediate` is always instant (keyboard and selection navigation), while
 * `reveal` is animated normally and instant under reduced motion — the difference
 * a `behavior: 'smooth'` argument used to erase, because an explicit argument
 * overrides the reduced-motion stylesheet.
 */
function ScrollIntentSample() {
  const paneRef = React.useRef<HTMLDivElement>(null)
  const scrollBehavior = useScrollBehavior()
  const rows = React.useMemo(() => Array.from({ length: 60 }, (_, index) => index), [])

  const reveal = (intent: 'immediate' | 'reveal') => {
    const pane = paneRef.current
    const target = pane?.querySelector<HTMLElement>('[data-scroll-target="true"]')
    if (!pane || !target) return
    pane.scrollTo({ top: target.offsetTop - pane.offsetTop, behavior: scrollBehavior(intent) })
  }

  return (
    <section className="space-y-2" data-testid="motion-scroll-intent">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Scroll intent</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" data-testid="motion-scroll-reveal" onClick={() => reveal('reveal')}>
            Reveal row 55
          </Button>
          <Button size="sm" variant="outline" data-testid="motion-scroll-immediate" onClick={() => reveal('immediate')}>
            Jump to row 55
          </Button>
        </div>
      </div>
      <div
        ref={paneRef}
        data-testid="motion-scroll-pane"
        className="relative h-[140px] overflow-y-auto rounded-lg border border-border/60 bg-background p-2"
      >
        {rows.map((row) => (
          <div
            key={row}
            data-scroll-target={row === 55 ? 'true' : undefined}
            className={cn(
              'h-6 truncate font-mono text-xs leading-6',
              row === 55 ? 'text-accent' : 'text-muted-foreground',
            )}
          >
            row {row}
          </div>
        ))}
      </div>
    </section>
  )
}

export const motionComponents: ComponentEntry[] = [
  {
    id: 'motion-primitives',
    name: 'Motion primitives',
    category: 'Motion',
    description:
      'Inline expand, same-level swap and tool-status handoff with rapid/reverse bursts — the acceptance surface for the shared motion rules under normal and reduced motion.',
    component: MotionSample,
    props: [],
    layout: 'top',
    previewOverflow: 'visible',
  },
]
