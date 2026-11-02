import { useTranslation } from 'react-i18next'
import { useContext } from 'react'
import { ShareSelectionContext } from './ShareSelection'
import { GitBranch, Send } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '../ui/StyledDropdown'

interface BranchDropdownProps {
  onBranch: (options?: { newPanel?: boolean }) => void
}

export function BranchDropdown({ onBranch }: BranchDropdownProps) {
  const { t } = useTranslation()
  const handleBranchClick = () => {
    onBranch({ newPanel: true })
  }

  return (
    <DropdownMenu>
      <Tooltip><TooltipTrigger asChild>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('chat.branchOptions')}
          className={cn(
            "craft-icon-button p-1 rounded-shape-sm transition-colors select-none",
            "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
            "data-[state=open]:text-foreground data-[state=open]:bg-foreground/5",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <GitBranch className={'w-3 h-3'} />
        </button>
      </DropdownMenuTrigger>
      </TooltipTrigger><TooltipContent>{t('chat.branch')}</TooltipContent></Tooltip>

      <StyledDropdownMenuContent align="end" minWidth="min-w-64" sideOffset={6}>
        <StyledDropdownMenuItem onClick={handleBranchClick} className="items-start py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-body leading-tight">{t('chat.branchFromThisMessage')}</span>
            <span className="max-w-[220px] whitespace-normal text-meta leading-tight text-muted-foreground">
              {t('chat.branchFromThisMessageDescription')}
            </span>
          </div>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

export function ResponseShareButton({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation()
  const selection = useContext(ShareSelectionContext)
  if (!onClick) return null
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" onClick={onClick} aria-label={t('chat.imageShare.share')}
      disabled={!!selection} aria-hidden={selection ? true : undefined} tabIndex={selection ? -1 : undefined}
      className={cn('craft-icon-button p-1 rounded-shape-sm text-muted-foreground hover:text-foreground', selection && 'invisible')}>
      <Send className="w-3.5 h-3.5" />
    </button>
  </TooltipTrigger><TooltipContent>{t('chat.imageShare.share')}</TooltipContent></Tooltip>
}
