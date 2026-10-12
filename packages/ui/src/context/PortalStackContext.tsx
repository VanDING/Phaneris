/** Portal DOM retains its React ancestry and the parent's semantic layer. */
import { createContext, useContext, type ReactNode } from 'react'

const PortalStackContext = createContext('var(--z-base)')
const PORTAL_LAYERS = {
  dropdown: '--z-dropdown', tooltip: '--z-tooltip', modal: '--z-modal', overlay: '--z-overlay', fullscreen: '--z-fullscreen',
} as const
export function usePortalLayer(layer: keyof typeof PORTAL_LAYERS, className?: string): string {
  const parent = useContext(PortalStackContext)
  // Islands explicitly own an absolute floor; preserve that existing policy.
  const explicit = className?.match(/(?:^|\s)z-(island(?:-overlay|-popover)?|floating-(?:backdrop|menu))(?:\s|$)/)?.[1]
  return explicit ? `var(--z-${explicit})` : `calc(${parent} + var(${PORTAL_LAYERS[layer]}))`
}
export function PortalStackProvider({ children, layer }: { children: ReactNode; layer: string }) {
  return <PortalStackContext.Provider value={layer}>{children}</PortalStackContext.Provider>
}
