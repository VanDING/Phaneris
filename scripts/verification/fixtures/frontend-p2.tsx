/** Actual components for the three post-merge frontend regressions. */
import * as React from 'react'
import { useTheme } from '@/context/ThemeContext'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EntityList } from '@/components/ui/entity-list'
import { CopyButton } from '../../../packages/ui/src/components/overlay/CopyButton'

export function FrontendP2Surface() {
  const theme = useTheme()
  const [short, setShort] = React.useState(false)
  const items = Array.from({ length: short ? 1 : 16 }, (_, index) => index)
  const row = (index: number) => <div key={index} className="h-8 px-3 text-body">Row {index + 1}</div>
  return <main data-p2-ready data-status={theme.themeLoadStatus} className="h-full overflow-auto bg-background p-4 text-foreground">
    <h1 className="text-title font-semibold">Frontend regression checks</h1>
    <div className="my-4 flex items-center gap-4">
      <div data-testid="p2-copy"><CopyButton content="P2 clipboard regression" title="Copy regression sample" /></div>
      <button type="button" data-testid="p2-content" className="craft-control" onClick={() => setShort(value => !value)}>Toggle content length</button>
      <div data-testid="p2-hairline" className="p-2 shadow-minimal" style={{ marginLeft: 'var(--edge-hairline)' }}>Hairline</div>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <section><h2 className="text-body">Settings viewport</h2>
        <div data-testid="p2-settings" className="h-40">
          <ScrollArea className="h-full" viewportClassName="mask-fade-y">{items.map(row)}</ScrollArea>
        </div>
      </section>
      <section><h2 className="text-body">Session list viewport</h2>
        <div data-testid="p2-list" className="flex h-40 flex-col">
          <EntityList items={items} renderItem={row} getKey={String} scrollAreaClassName="select-none" scrollViewportClassName="mask-fade-top-short" />
        </div>
      </section>
      <section><h2 className="text-body">Sidebar scroller</h2>
        <div data-testid="p2-sidebar" className="h-40 overflow-y-auto mask-fade-bottom">{items.map(row)}</div>
      </section>
    </div>
  </main>
}
