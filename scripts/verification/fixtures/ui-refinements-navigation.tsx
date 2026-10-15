/** Inject only the navigation service; all controls under review use production code. */
import { createContext, useContext } from 'react'

export const NavigationContext = createContext<{ navigateToSession: (id: string) => void } | null>(null)
export function useNavigation() {
  const value = useContext(NavigationContext)
  if (!value) throw new Error('Navigation fixture provider missing')
  return value
}
