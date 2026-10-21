/**
 * SegmentedTabs — one tab strip, one keyboard contract.
 *
 * The product had three tab grammars (underline text, filled pill, segmented
 * control) and only some of them were keyboard-navigable: the workbench strip
 * had roving focus, the Files view tabs were plain buttons a screen reader heard
 * as tabs with no arrow keys. This wraps the shared `useRovingFocus` hook so a
 * tablist always answers Arrow/Home/End and keeps a single tab stop, while the
 * *appearance* stays a prop: `underline` for panel views, `segment` for filters.
 *
 * Selection follows focus on arrow keys (the automatic-activation pattern): a
 * tab strip whose arrow keys only move focus but do not switch the view reads as
 * broken, and these panels are cheap to re-render.
 */
import * as React from 'react'
import { useRovingFocus } from '@phaneris/ui/roving-focus'
import { cn } from '@/lib/utils'

export type SegmentedTabsAppearance = 'underline' | 'segment'

export interface SegmentedTabItem<T extends string> {
  id: T
  label: React.ReactNode
}

export interface SegmentedTabsProps<T extends string> {
  items: ReadonlyArray<SegmentedTabItem<T>>
  value: T
  onChange: (value: T) => void
  appearance?: SegmentedTabsAppearance
  /** Accessible name for the tablist. */
  ariaLabel: string
  className?: string
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  appearance = 'underline',
  ariaLabel,
  className,
}: SegmentedTabsProps<T>) {
  const ids = React.useMemo(() => items.map(item => item.id), [items])
  const roving = useRovingFocus(ids, {
    orientation: 'horizontal',
    onActiveChange: id => onChange(id as T),
  })

  // Keep the roving tab stop on the selected tab when the value is changed from
  // outside (a deep link, a keyboard shortcut, the workbench restoring a view).
  React.useEffect(() => {
    if (value !== roving.activeId) roving.setActiveId(value)
  }, [value, roving])

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('flex min-w-0 items-stretch', className)}>
      {items.map(item => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            {...roving.getItemProps(item.id)}
            onClick={() => onChange(item.id)}
            className={cn(
              'craft-segment relative shrink-0 px-0.5 text-label font-medium',
              appearance === 'segment' && 'rounded-shape-sm px-2',
              selected
                ? 'text-foreground'
                : 'text-text-secondary hover:text-foreground',
              // The underline is drawn by the selected tab, not the container:
              // it tracks the tab's own width so the marker cannot drift.
              appearance === 'underline' && selected
                && 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t after:bg-accent',
              appearance === 'segment' && selected && 'bg-background shadow-minimal',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
