/**
 * Declarative menu shell.
 *
 * One API for the common case: a trigger plus a list of entries. Entries carry
 * content (label/icon/shortcut/checked/danger) instead of each caller composing
 * Radix primitives and re-implementing keyboard, styling or z-index behavior.
 *
 * Context menus reuse the same entry model through `MenuEntries` in the
 * renderer, which swaps in the context-menu primitives.
 */
import * as React from 'react'
import { Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuLabel,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSubTrigger,
} from './StyledDropdown'

export interface MenuItemEntry {
  kind?: 'item'
  label: React.ReactNode
  icon?: React.ReactNode
  shortcut?: string
  variant?: 'default' | 'destructive'
  disabled?: boolean
  checked?: boolean
  onSelect?: () => void
}

export interface MenuSeparatorEntry {
  kind: 'separator'
}

export interface MenuLabelEntry {
  kind: 'label'
  label: React.ReactNode
}

export interface MenuSubmenuEntry {
  kind: 'submenu'
  label: React.ReactNode
  icon?: React.ReactNode
  items: MenuEntry[]
}

export type MenuEntry = MenuItemEntry | MenuSeparatorEntry | MenuLabelEntry | MenuSubmenuEntry

/** Shared renderer so the dropdown shell and the context-menu adapter stay identical. */
export function renderMenuEntries(entries: MenuEntry[], components: {
  Item: typeof StyledDropdownMenuItem
  Separator: typeof StyledDropdownMenuSeparator
  Label: typeof StyledDropdownMenuLabel
  Sub: typeof DropdownMenuSub
  SubTrigger: typeof StyledDropdownMenuSubTrigger
  SubContent: typeof StyledDropdownMenuSubContent
}): React.ReactNode {
  const { Item, Separator, Label, Sub, SubTrigger, SubContent } = components
  return entries.map((entry, index) => {
    if (entry.kind === 'separator') return <Separator key={index} />
    if (entry.kind === 'label') return <Label key={index}>{entry.label}</Label>
    if (entry.kind === 'submenu') {
      return (
        <Sub key={index}>
          <SubTrigger>
            {entry.icon}
            <span className="flex-1">{entry.label}</span>
          </SubTrigger>
          <SubContent>{renderMenuEntries(entry.items, components)}</SubContent>
        </Sub>
      )
    }
    return (
      <Item
        key={index}
        variant={entry.variant}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        {entry.checked ? <Check /> : entry.icon}
        <span className="flex-1">{entry.label}</span>
        {entry.shortcut && <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>}
      </Item>
    )
  })
}

export interface MenuProps {
  trigger: React.ReactNode
  items: MenuEntry[]
  align?: React.ComponentPropsWithoutRef<typeof StyledDropdownMenuContent>['align']
  side?: React.ComponentPropsWithoutRef<typeof StyledDropdownMenuContent>['side']
  sideOffset?: number
  minWidth?: string
  className?: string
  contentClassName?: string
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Menu({
  trigger,
  items,
  align = 'end',
  side,
  sideOffset = 4,
  minWidth,
  className,
  contentClassName,
  disabled,
  open,
  onOpenChange,
}: MenuProps) {
  const components = {
    Item: StyledDropdownMenuItem,
    Separator: StyledDropdownMenuSeparator,
    Label: StyledDropdownMenuLabel,
    Sub: DropdownMenuSub,
    SubTrigger: StyledDropdownMenuSubTrigger,
    SubContent: StyledDropdownMenuSubContent,
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled} className={className}>
        {trigger}
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align={align} side={side} sideOffset={sideOffset} minWidth={minWidth} className={contentClassName}>
        {renderMenuEntries(items, components)}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
