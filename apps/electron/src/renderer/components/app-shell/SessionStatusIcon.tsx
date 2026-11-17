import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SessionStatusMenu } from "@/components/ui/session-status-menu"
import { getStateIcon, getStateIconStyle } from "@/config/session-status-config"
import { useSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"
import { getSessionStatus } from "@/utils/session"

interface SessionStatusIconProps {
  item: SessionMeta
}

export function SessionStatusIcon({ item }: SessionStatusIconProps) {
  const { t } = useTranslation()
  const ctx = useSessionListContext()
  const [open, setOpen] = useState(false)
  const status = getSessionStatus(item)

  const handleSelect = (state: import("@/config/session-status-config").SessionStatusId) => {
    setOpen(false)
    ctx.onSessionStatusChange(item.id, state)
  }

  return (
    <Popover modal={true} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // 24×24 hit area (WCAG 2.2 SC 2.5.8); the glyph stays 20px so the row's
            // visual rhythm is unchanged — only the target grew.
            "craft-icon-button size-control-sm shrink-0 flex items-center justify-center rounded-full transition-colors cursor-pointer",
            "hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "[&>svg]:w-5 [&>svg]:h-5 [&>img]:w-5 [&>img]:h-5 [&>span]:text-reading",
          )}
          style={getStateIconStyle(status, ctx.sessionStatuses)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("status.change")}
          onMouseDown={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {getStateIcon(status, ctx.sessionStatuses)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        align="start"
        side="bottom"
        sideOffset={4}
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <SessionStatusMenu
          activeState={status}
          onSelect={handleSelect}
          states={ctx.sessionStatuses}
          isArchived={item.isArchived}
          onArchive={ctx.onArchive ? () => { setOpen(false); ctx.onArchive!(item.id) } : undefined}
          onUnarchive={ctx.onUnarchive ? () => { setOpen(false); ctx.onUnarchive!(item.id) } : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}



