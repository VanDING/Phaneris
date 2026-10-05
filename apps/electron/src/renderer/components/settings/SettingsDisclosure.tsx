import { useId, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SettingsCard } from './SettingsCard'
import { settingsUI } from './SettingsUIConstants'

/** A single settings row opens its content; separate instances remain independent. */
export function SettingsDisclosure({ title, summary, open, onOpenChange, children }: {
  title: string
  summary: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const id = useId()
  const Chevron = open ? ChevronDown : ChevronRight
  return <SettingsCard divided={false}>
    <button type="button" data-ai-advanced-toggle data-layout="settings-row" aria-expanded={open} aria-controls={id}
      onClick={() => onOpenChange(!open)}
      className="craft-settings-row craft-focus craft-row-focus w-full flex flex-wrap items-center justify-between gap-3 px-4 py-[var(--theme-settings-row-padding-y)] text-left hover:bg-foreground/[0.02] motion-interactive transition-colors">
      <span className={`${settingsUI.label} flex-1 basis-32 min-w-0`}>{title}</span>
      <span className="flex items-center justify-end gap-2 min-w-0 max-w-full sm:max-w-[65%]">
        <span className="text-xs text-muted-foreground text-right break-words">{summary}</span>
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
      </span>
    </button>
    <div id={id} hidden={!open} className={open ? 'border-t border-border/50' : undefined}>{open && children}</div>
  </SettingsCard>
}
