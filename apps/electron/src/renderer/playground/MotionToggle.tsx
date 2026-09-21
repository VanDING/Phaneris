import * as React from 'react'
import { Accessibility, Sparkles, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Explicit motion preference switch for the Playground.
 *
 * The Playground is the acceptance harness for component interaction, so it has
 * to be able to show the reduced-motion behaviour of a component on a machine
 * whose OS preference is not set — otherwise "check it under reduce" requires
 * changing system settings and a restart.
 *
 * `system` matches production hosts (`MotionConfig reducedMotion="user"`).
 * `reduced`/`normal` force the branch so both paths can be compared side by
 * side. The forced value is mirrored onto `<html data-reduce-motion>` so CSS-level
 * animation and transitions follow the same switch as the Motion tree — the OS
 * media query alone cannot see this control.
 */

export type PlaygroundMotionPreference = 'system' | 'normal' | 'reduced'

const STORAGE_KEY = 'playground-motion-preference'

const PREFERENCES: { value: PlaygroundMotionPreference; icon: typeof Sparkles; label: string }[] = [
  { value: 'system', icon: Monitor, label: 'System' },
  { value: 'normal', icon: Sparkles, label: 'Normal' },
  { value: 'reduced', icon: Accessibility, label: 'Reduced' },
]

/** MotionConfig's own vocabulary for the same three states. */
export const MOTION_CONFIG_BY_PREFERENCE = {
  system: 'user',
  normal: 'never',
  reduced: 'always',
} as const satisfies Record<PlaygroundMotionPreference, 'user' | 'never' | 'always'>

function loadPreference(): PlaygroundMotionPreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'system' || saved === 'normal' || saved === 'reduced') return saved
  } catch {
    // Ignore storage errors — fall through to the system default.
  }
  return 'system'
}

export function usePlaygroundMotionPreference() {
  const [preference, setPreference] = React.useState<PlaygroundMotionPreference>(loadPreference)

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Ignore storage errors
    }
  }, [preference])

  // Forced reduce has to reach plain CSS too: media queries cannot see this
  // control, so the reduced ruleset is also keyed on the attribute.
  React.useEffect(() => {
    const root = document.documentElement
    if (preference === 'reduced') {
      root.setAttribute('data-reduce-motion', 'true')
    } else {
      root.removeAttribute('data-reduce-motion')
    }
    return () => root.removeAttribute('data-reduce-motion')
  }, [preference])

  return [preference, setPreference] as const
}

interface MotionToggleProps {
  preference: PlaygroundMotionPreference
  onPreferenceChange: (preference: PlaygroundMotionPreference) => void
}

export function MotionToggle({ preference, onPreferenceChange }: MotionToggleProps) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-lg bg-foreground/5"
      role="radiogroup"
      aria-label="Motion preference"
    >
      {PREFERENCES.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          onClick={() => onPreferenceChange(value)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
            preference === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title={`${label} motion`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}
