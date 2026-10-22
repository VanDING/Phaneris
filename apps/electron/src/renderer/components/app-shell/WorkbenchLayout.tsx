import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { animate, motion, useMotionValue, useReducedMotionConfig } from 'motion/react'
import { motionTween } from '@phaneris/ui/motion'
import { MIN_COMPANION_PRIMARY_WIDTH, MIN_WORKBENCH_WIDTH, type SurfaceRenderEntry } from '@/atoms/workbench'
import { PANEL_GAP, PANEL_MIN_WIDTH } from './panel-constants'

/** Both panels spend one content-row budget, excluding the sidebar/navigator. */
export function workbenchWidths(row: number, requested: number, open: boolean, full: boolean, conversations: number) {
  const maximum = Math.max(MIN_COMPANION_PRIMARY_WIDTH, row - PANEL_GAP - MIN_WORKBENCH_WIDTH)
  const companion = Math.min(maximum, Math.max(MIN_COMPANION_PRIMARY_WIDTH, requested))
  return {
    maximum,
    primary: full ? 0 : open ? companion : Math.max(row, conversations > 1 ? conversations * PANEL_MIN_WIDTH + (conversations - 1) * PANEL_GAP : 0),
    workbench: !open ? 0 : full ? row : Math.max(MIN_WORKBENCH_WIDTH, row - PANEL_GAP - companion),
    gap: open && !full ? PANEL_GAP : 0,
  }
}

interface WorkbenchLayoutProps {
  entry?: SurfaceRenderEntry
  fullWidth: boolean
  primaryWidth: number
  conversations: number
  isResizing?: boolean
  primary: React.ReactNode
  renderWorkbench: (entry: SurfaceRenderEntry, primaryWidth: number, maximum: number) => React.ReactNode
}

/** A persistent dock gives opening and closing the same painted starting point. */
export function WorkbenchLayout({ entry, fullWidth, primaryWidth, conversations, isResizing, primary, renderWorkbench }: WorkbenchLayoutProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [rowWidth, setRowWidth] = useState(0)
  const previousRowWidth = useRef(rowWidth)
  const [retained, setRetained] = useState(entry)
  const reduceMotion = useReducedMotionConfig()
  const primarySize = useMotionValue(0)
  const dockSize = useMotionValue(0)
  const gapSize = useMotionValue(0)
  const primaryRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    setRowWidth(row.getBoundingClientRect().width)
    // ResizeObserver runs before paint. Commit and jump the motion values here,
    // rather than scheduling a zero-duration tween for a later animation frame.
    const observer = new ResizeObserver(([size]) => flushSync(() => setRowWidth(size.contentRect.width)))
    observer.observe(row)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => { if (entry) setRetained(entry) }, [entry])
  const widths = workbenchWidths(rowWidth, primaryWidth, !!entry, fullWidth, conversations)
  const open = !!entry
  useLayoutEffect(() => {
    const snap = isResizing || reduceMotion || previousRowWidth.current !== rowWidth
    previousRowWidth.current = rowWidth
    const targets = [[primarySize, widths.primary], [dockSize, widths.workbench], [gapSize, widths.gap]] as const
    if (snap) {
      for (const [value, target] of targets) value.jump(target)
      // Motion normally paints on the next rAF. Resize and pointer ownership
      // require these dimensions in this paint, including a resize mid-tween.
      if (primaryRef.current) primaryRef.current.style.width = `${widths.primary}px`
      if (dockRef.current) {
        dockRef.current.style.width = `${widths.workbench}px`
        dockRef.current.style.marginLeft = `${widths.gap}px`
      }
      if (!open) setRetained(undefined)
      return
    }
    let active = true
    const controls = targets.map(([value, target]) => animate(value, target, motionTween(reduceMotion, 'spatial', 'move')))
    void controls[1].then(() => { if (active && !open) setRetained(undefined) })
    return () => { active = false; controls.forEach(control => control.stop()) }
  }, [widths.primary, widths.workbench, widths.gap, rowWidth, open, isResizing, reduceMotion, primarySize, dockSize, gapSize])
  const rendered = entry ?? retained

  return (
    <div ref={rowRef} className="flex h-full min-w-0 flex-1" data-workbench-row>
      <motion.div ref={primaryRef} className="flex h-full shrink-0" style={{ gap: PANEL_GAP, width: primarySize }} initial={false}>
        {primary}
      </motion.div>
      <motion.div ref={dockRef} className="relative flex h-full shrink-0" data-workbench-dock
        inert={!entry} aria-hidden={!entry || undefined}
        initial={false} style={{ width: dockSize, marginLeft: gapSize }}>
        {rendered && renderWorkbench(rendered, widths.primary, widths.maximum)}
      </motion.div>
    </div>
  )
}
