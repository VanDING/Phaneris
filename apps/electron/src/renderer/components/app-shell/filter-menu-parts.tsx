/**
 * Presentational parts of the sidebar label-filter menu.
 *
 * Extracted from AppShell, which had grown past 4,200 lines with these five
 * helpers inlined above the component: a tooltip wrapper, the include/exclude
 * badge, the mode sub-menu, the shared row layout and the recursive label tree.
 * They are props-driven and hold no state, so they move without changing any
 * behaviour — AppShell keeps the filter state and passes it down.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Trash2, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@phaneris/ui'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/platform'
import {
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import type { FilterMode } from './inherited-filter-params'

const altClickTooltipLabel = isMac ? '⌥ click to exclude' : 'Alt click to exclude'

/** Wraps children in a Tooltip that shows instantly on hover — only rendered when `show` is true. */
export function AltExcludeTooltip({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return children
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="text-meta">{altClickTooltipLabel}</TooltipContent>
    </Tooltip>
  )
}

/**
 * FilterModeBadge - Display-only badge showing the current filter mode.
 * Shows a checkmark for 'include' and an X for 'exclude'. Used as a visual
 * indicator inside DropdownMenuSubTrigger rows (the actual mode switching
 * happens via the sub-menu content, not this badge).
 */
export function FilterModeBadge({ mode }: { mode: FilterMode }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center h-5 w-5 rounded-shape-sm -mr-1",
        mode === 'include'
          ? "bg-background text-foreground shadow-minimal"
          : "bg-destructive/10 text-destructive shadow-tinted",
      )}
      style={mode === 'exclude' ? { '--shadow-color': 'var(--destructive)' } as React.CSSProperties : undefined}
    >
      {mode === 'include' ? <Check className="!h-2.5 !w-2.5" /> : <X className="!h-2.5 !w-2.5" />}
    </span>
  )
}

/**
 * FilterModeSubMenuItems - Shared sub-menu content for switching filter mode.
 * Renders Include / Exclude / Remove options using StyledDropdownMenuItem for
 * consistent styling. Used inside StyledDropdownMenuSubContent by both leaf
 * and group label items when they have an active filter mode.
 */
export function FilterModeSubMenuItems({
  mode,
  onChangeMode,
  onRemove,
}: {
  mode: FilterMode
  onChangeMode: (mode: FilterMode) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('include') }}
        className={cn(mode === 'include' && "bg-foreground/[0.04]")}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("filter.include")}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('exclude') }}
        className={cn(mode === 'exclude' && "bg-foreground/[0.04]")}
      >
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("filter.exclude")}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onRemove() }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("common.clear")}</span>
      </StyledDropdownMenuItem>
    </>
  )
}

/**
 * FilterMenuRow - Consistent layout for filter menu items.
 * Enforces: [icon 14px box] [label flex] [accessory 12px box]
 */
export function FilterMenuRow({
  icon,
  label,
  accessory,
  iconClassName,
  iconStyle,
  noIconContainer,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  accessory?: React.ReactNode
  /** Additional classes for icon container (e.g., for status icon scaling) */
  iconClassName?: string
  /** Style for icon container (e.g., for status icon color) */
  iconStyle?: React.CSSProperties
  /** When true, skip the icon container (for icons that have their own container) */
  noIconContainer?: boolean
}) {
  return (
    <>
      {noIconContainer ? (
        // Wrapper for color inheritance. Clone icon to add bare prop (removes EntityIcon container).
        <span style={iconStyle}>
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true }) : icon}
        </span>
      ) : (
        <span
          className={cn("h-3.5 w-3.5 flex items-center justify-center shrink-0", iconClassName)}
          style={iconStyle}
        >
          {icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      <span className="shrink-0">{accessory}</span>
    </>
  )
}
