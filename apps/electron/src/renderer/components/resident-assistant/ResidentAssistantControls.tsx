import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, MoreHorizontal } from 'lucide-react'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ResidentAssistantDetails, type AssistantDetail } from './ResidentAssistantDetails'
import './resident-assistant.css'

/** Management uses the existing dialog; the existing chat keeps its full width. */
export function ResidentAssistantControls({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [detail, setDetail] = React.useState<AssistantDetail | null>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><PreviewHeaderIconButton ref={trigger} data-testid="resident-details-trigger"
        tooltip={t('residentAssistant.details')} aria-label={t('residentAssistant.details')}><MoreHorizontal className="size-4" /></PreviewHeaderIconButton></DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" onCloseAutoFocus={event => { if (detail) event.preventDefault() }}>
        <StyledDropdownMenuItem data-testid="resident-work-tab" onSelect={() => setDetail('work')}><ListChecks className="size-4" />{t('residentAssistant.work')}</StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null) }}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader><DialogTitle>{t(`residentAssistant.${detail ?? 'details'}`)}</DialogTitle><DialogDescription>{t('residentAssistant.workHint')}</DialogDescription></DialogHeader>
        {detail && <ResidentAssistantDetails key={`${workspaceId}:${detail}`} workspaceId={workspaceId} detail={detail} />}
      </DialogContent>
    </Dialog>
  </>
}
