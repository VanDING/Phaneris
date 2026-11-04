import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Globe } from 'lucide-react'
import { TopBarButton } from '@/components/ui/TopBarButton'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { SURFACE_LAUNCHER_KINDS, surfaceLauncherLabelKey, type SurfaceLauncherKind } from '@/lib/surface-launchers'
import { SURFACE_LAUNCHER_ICONS } from './SurfaceLauncherButtons'
import { SquarePenRounded } from '../icons/SquarePenRounded'

/** The same launch actions remain reachable when the centered brand reserves space. */
export function CompactSurfaceLaunchers({ onOpenLauncher, onOpenBrowser, onNewSession, onNewBrowser }: {
  onOpenLauncher(kind: SurfaceLauncherKind): void; onOpenBrowser(): void; onNewSession(): void; onNewBrowser(): void
}) {
  const { t } = useTranslation()
  return <DropdownMenu><DropdownMenuTrigger asChild><TopBarButton aria-label={t('topBar.tools')}><MoreHorizontal className="size-4" /></TopBarButton></DropdownMenuTrigger>
    <StyledDropdownMenuContent align="end">
      <StyledDropdownMenuItem onSelect={onNewSession}><SquarePenRounded className="size-4" />{t('session.newSessionInPanel')}</StyledDropdownMenuItem>
      {SURFACE_LAUNCHER_KINDS.map(kind => { const Icon = SURFACE_LAUNCHER_ICONS[kind]; return <StyledDropdownMenuItem key={kind} onSelect={() => onOpenLauncher(kind)}><Icon className="size-4" />{t(surfaceLauncherLabelKey(kind))}</StyledDropdownMenuItem> })}
      <StyledDropdownMenuItem onSelect={onOpenBrowser}><Globe className="size-4" />{t('contentPanel.button.browser')}</StyledDropdownMenuItem>
      <StyledDropdownMenuItem onSelect={onNewBrowser}><Globe className="size-4" />{t('topBar.newBrowserWindow')}</StyledDropdownMenuItem>
    </StyledDropdownMenuContent>
  </DropdownMenu>
}
