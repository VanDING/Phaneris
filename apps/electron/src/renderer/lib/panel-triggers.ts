/**
 * Trigger-type panel opener (used when overlays converge into panels, Task 10).
 *
 * Triggered content opens or activates a Context Workbench tab. There is no
 * foreground capacity/LRU replacement in the v2 Surface model. Files is the
 * only triggerable bound panel; chat pop-outs render in the shared overlay.
 */

import { useCallback } from 'react'
import { useStore } from 'jotai'
import { openWorkbenchItemAtom } from '@/atoms/workbench'

export function usePanelTriggerOpener() {
  const store = useStore()

  return useCallback((kind: 'files'): void => {
    store.set(openWorkbenchItemAtom, kind)
  }, [store])
}
