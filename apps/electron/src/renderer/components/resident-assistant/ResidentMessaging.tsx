import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { useMessagingConnect, type MessagingPlatform } from '@/components/messaging/MessagingSessionMenuItem'

const platforms: MessagingPlatform[] = ['wechat', 'telegram', 'wecom', 'whatsapp', 'lark']
const TelegramSetup = React.lazy(() => import('@/components/messaging/TelegramConnectDialog').then(module => ({ default: module.TelegramConnectDialog })))
const LarkSetup = React.lazy(() => import('@/components/messaging/LarkConnectDialog').then(module => ({ default: module.LarkConnectDialog })))
const WeComSetup = React.lazy(() => import('@/components/messaging/WeComConnectDialog').then(module => ({ default: module.WeComConnectDialog })))

export function ResidentMessaging({ sessionId, config, bindings, connected, unavailable, onChanged }: {
  sessionId: string; config?: Awaited<ReturnType<typeof window.electronAPI.getMessagingConfig>>
  bindings: Awaited<ReturnType<typeof window.electronAPI.getMessagingBindings>>; connected: boolean; unavailable: boolean; onChanged(): void
}) {
  const { t } = useTranslation()
  const [setup, setSetup] = React.useState<MessagingPlatform>()
  const [awaitingPair, setAwaitingPair] = React.useState<MessagingPlatform>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const connect = useMessagingConnect({ sessionId, onPlatformNotConfigured: setSetup })
  const linked = bindings.filter(binding => binding.sessionId === sessionId && binding.enabled)
  React.useEffect(() => {
    if (awaitingPair && config?.runtime[awaitingPair]?.connected) { setAwaitingPair(undefined); void connect(awaitingPair) }
    else if (awaitingPair && config?.runtime[awaitingPair]?.lastError) { setError(config.runtime[awaitingPair]!.lastError); setAwaitingPair(undefined) }
  }, [awaitingPair, config, connect])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(undefined)
    const result = await Promise.allSettled([action()])
    if (result[0].status === 'rejected') setError(String(result[0].reason))
    setBusy(false); onChanged()
  }
  const picker = <DropdownMenu><DropdownMenuTrigger asChild>
    {linked.length ? <PreviewHeaderIconButton tooltip={t('residentAssistant.panel.addChannel')} aria-label={t('residentAssistant.panel.addChannel')} disabled={busy || !connected}><Plus className="size-4" /></PreviewHeaderIconButton>
      : <Button size="sm" variant="outline" data-testid="resident-connect-channel" disabled={busy || !connected}>{t('residentAssistant.panel.connect')}<Plus className="size-3" /></Button>}
  </DropdownMenuTrigger><StyledDropdownMenuContent align="end" sideOffset={8}>
    {platforms.map(platform => <StyledDropdownMenuItem key={platform} data-testid={`resident-connect-${platform}`} onSelect={() => void run(() => connect(platform))}>{t(`residentAssistant.panel.platform.${platform}`)}</StyledDropdownMenuItem>)}
  </StyledDropdownMenuContent></DropdownMenu>
  return <section className="resident-messaging" data-testid="resident-section-messaging">
    {linked.length ? <details>
      <summary className="craft-control resident-panel-summary resident-channel-summary"><MessageSquare className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{linked.map(binding => t(`residentAssistant.panel.platform.${binding.platform}`, binding.platform)).join(' · ')}</span><span className="text-meta text-text-secondary">{t('residentAssistant.panel.channelSettings')}</span></summary>
      <div className="resident-section-heading"><h3 className="text-label font-medium">{t('residentAssistant.panel.messaging')}</h3>{picker}</div>
      {linked.map(binding => <div key={binding.id} className="resident-connected-channel" data-testid="resident-connected-channel">
        <MessageSquare className="size-4 text-text-secondary" aria-hidden="true" />
        <div className="min-w-0 flex-1"><p className="text-body">{t(`residentAssistant.panel.platform.${binding.platform}`, binding.platform)}<span className="resident-channel-state text-meta" data-connected={!!config?.runtime[binding.platform]?.connected}>{t(config?.runtime[binding.platform]?.connected ? 'residentAssistant.panel.channelLinked' : 'residentAssistant.panel.channelDisconnected')}</span></p>
          <p className="text-meta text-text-secondary truncate">{binding.channelName ?? binding.channelId}</p></div>
        <DropdownMenu><DropdownMenuTrigger asChild><PreviewHeaderIconButton tooltip={t('residentAssistant.panel.channelSettings')} aria-label={t('residentAssistant.panel.channelSettings')} disabled={busy}><MoreHorizontal className="size-4" /></PreviewHeaderIconButton></DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end"><StyledDropdownMenuItem onSelect={() => void run(() => connect(binding.platform as MessagingPlatform))}>{t('residentAssistant.panel.channelSettings')}</StyledDropdownMenuItem>
            <StyledDropdownMenuItem onSelect={() => void run(() => window.electronAPI.unbindMessagingBinding(binding.id))}>{t('residentAssistant.panel.unbind')}</StyledDropdownMenuItem></StyledDropdownMenuContent></DropdownMenu>
      </div>)}
    </details> : <div className="resident-connect-prompt"><MessageSquare className="size-4 text-text-secondary" aria-hidden="true" />
      <div className="min-w-0 flex-1"><h3 className="text-label font-medium">{t('residentAssistant.panel.messaging')}</h3></div>{picker}</div>}
    {unavailable && <p className="text-meta text-text-secondary mt-2">{t('residentAssistant.panel.messagingUnavailable')}</p>}
    {awaitingPair && <p role="status" className="text-meta text-text-secondary mt-2">{t('residentAssistant.panel.pairingPending', { platform: t(`residentAssistant.panel.platform.${awaitingPair}`) })}</p>}
    {error && <p role="alert" className="text-label text-destructive-text break-words mt-2">{error}</p>}
    <React.Suspense fallback={null}>
      {setup === 'telegram' && <TelegramSetup open onOpenChange={open => { if (!open) setSetup(undefined) }} onSaved={() => setAwaitingPair('telegram')} />}
      {setup === 'lark' && <LarkSetup open onOpenChange={open => { if (!open) setSetup(undefined) }} onSaved={() => setAwaitingPair('lark')} />}
      {setup === 'wecom' && <WeComSetup open onOpenChange={open => { if (!open) setSetup(undefined) }} onSaved={() => setAwaitingPair('wecom')} />}
    </React.Suspense>
  </section>
}
