/**
 * MenuEntries — renders the shared `MenuEntry[]` model with whichever menu
 * primitives the surrounding context provides (dropdown or context menu).
 *
 * This is the convergence point for content menus: callers describe entries
 * once; the shell owns styling, keyboard behavior and z-index.
 */
import * as React from 'react'
import type { MenuEntry } from '@phaneris/ui'
import { useMenuComponents } from './menu-context'

type ItemProps = {
  variant?: 'default' | 'destructive'
  disabled?: boolean
  onClick?: () => void
  children?: React.ReactNode
}

export function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()
  const Item = MenuItem as React.ComponentType<ItemProps>
  const SubMenu = Sub as React.ComponentType<{ children?: React.ReactNode }>
  const SubMenuTrigger = SubTrigger as React.ComponentType<{ children?: React.ReactNode }>
  const SubMenuContent = SubContent as React.ComponentType<{ children?: React.ReactNode }>

  return (
    <>
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <Separator key={index} />
        if (entry.kind === 'label') {
          return (
            <div key={index} className="px-2 py-1.5 text-micro font-medium text-text-tertiary">
              {entry.label}
            </div>
          )
        }
        if (entry.kind === 'submenu') {
          return (
            <SubMenu key={index}>
              <SubMenuTrigger>
                {entry.icon}
                <span className="flex-1">{entry.label}</span>
              </SubMenuTrigger>
              <SubMenuContent>
                <MenuEntries entries={entry.items} />
              </SubMenuContent>
            </SubMenu>
          )
        }
        return (
          <Item
            key={index}
            variant={entry.variant}
            disabled={entry.disabled}
            onClick={entry.onSelect}
          >
            {entry.checked ? <span className="w-3.5 text-center">✓</span> : entry.icon}
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && <span className="ml-auto pl-4 text-micro text-text-tertiary">{entry.shortcut}</span>}
          </Item>
        )
      })}
    </>
  )
}
