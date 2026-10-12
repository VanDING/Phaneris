import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import { PortalStackProvider, usePortalLayer } from '@phaneris/ui/context'

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 20,
  style,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const layer = usePortalLayer('dropdown', className)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={{ zIndex: layer, ...style }}
        className={cn(
          "craft-popover popover-styled craft-float-motion motion-surface z-dropdown w-72 origin-(--radix-popover-content-transform-origin) p-4 outline-hidden",
          className
        )}
        {...props}
      ><PortalStackProvider layer={String(style?.zIndex ?? layer)}>{children}</PortalStackProvider></PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
