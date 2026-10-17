import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { cn } from "@/lib/utils"

interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  /** Ref to the scrollable viewport element */
  viewportRef?: React.RefObject<HTMLDivElement | null>
  /** Classes for the element that actually scrolls (e.g. scroll-driven masks). */
  viewportClassName?: string
}

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportClassName,
  ...props
}: ScrollAreaProps) {
  const fallbackViewportRef = React.useRef<HTMLDivElement>(null)
  const resolvedViewportRef = viewportRef ?? fallbackViewportRef

  React.useLayoutEffect(() => {
    const viewport = resolvedViewportRef.current
    if (!viewport || !viewportClassName) return

    // Radix keeps overflow: scroll on its viewport. When content shrinks, its
    // scroll timeline can retain the previous filled frame at a zero range.
    const updateOverflow = () => {
      viewport.dataset.scrollableY = String(viewport.scrollHeight > viewport.clientHeight)
    }
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    updateOverflow()
    return () => { observer.disconnect() }
  }, [resolvedViewportRef, viewportClassName])

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={resolvedViewportRef}
        className={cn("h-full w-full rounded-[inherit]", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-bar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" &&
          "h-full w-2 border-l border-l-transparent p-[1px]",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
