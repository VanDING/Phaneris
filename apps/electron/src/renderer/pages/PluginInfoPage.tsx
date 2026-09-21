/**
 * PluginInfoPage
 *
 * A plugin bundle's own page in the content panel, mirroring SourceInfoPage and
 * SkillInfoPage. Uses the Info_ component system so it matches its siblings.
 *
 * What this page is for: a bundle is the one place where contributed skills and
 * sources are visible *together* with the manifest that declared them — which is
 * what a user needs when deciding whether to keep it, or when working out why a
 * skill it brought behaves the way it does. It deliberately does not re-own the
 * contributed resources: each row links into the Skills / Sources section that
 * actually manages it (plugin-bundles design P7-2).
 *
 * The bundle list comes from the shell rather than a fresh RPC call: the shell
 * already loads it for the `/` roster, subscribes to `plugins:changed`, and
 * re-renders this page when that state changes, so re-fetching here would only
 * add a way for the two copies to disagree.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SendResourceToWorkspaceDialog } from '@/components/app-shell/SendResourceToWorkspaceDialog'
import { PluginMenu } from '@/components/app-shell/PluginMenu'
import { Info_Alert, Info_Page, Info_Section, Info_Table, Info_Markdown } from '@/components/info'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { getFileManagerName } from '@/lib/platform'
import type { PluginUninstallPlan, PluginSummary } from '../../shared/types'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { PluginAvatar } from '@/components/ui/plugin-avatar'

interface PluginInfoPageProps {
  pluginName: string
  workspaceId: string
}

export default function PluginInfoPage({ pluginName, workspaceId }: PluginInfoPageProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer

  // The shell's list is the single source; this page is a view over it.
  const { plugins, workspaces } = useAppShellContext()
  const [sendOpen, setSendOpen] = React.useState(false)
  const plugin: PluginSummary | undefined = React.useMemo(
    () => (plugins ?? []).find((p) => p.name === pluginName),
    [plugins, pluginName],
  )

  const [uninstallPlan, setUninstallPlan] = React.useState<PluginUninstallPlan | null>(null)
  const [uninstallBusy, setUninstallBusy] = React.useState(false)

  const handleReveal = React.useCallback(async () => {
    if (!plugin || !canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(plugin.path)
    } catch (error) {
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [plugin, canRevealLocally, t])

  // Same two-phase flow as the list row menu: analyze, show exactly what is
  // removed versus retained, then uninstall.
  const requestUninstall = React.useCallback(async () => {
    if (!plugin) return
    try {
      setUninstallPlan(await window.electronAPI.analyzePluginUninstall(workspaceId, plugin.name))
    } catch (error) {
      toast.error(t('pluginsList.uninstallFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [plugin, workspaceId, t])

  const confirmUninstall = React.useCallback(async () => {
    if (!uninstallPlan) return
    setUninstallBusy(true)
    try {
      await window.electronAPI.uninstallPlugin(workspaceId, uninstallPlan.name)
      // Deactivating first would leave the slot pointing at a bundle that is
      // about to stop existing; clearing after the removal is the same outcome
      // either way, so it is not ordered here.
      toast.success(t('pluginsList.uninstalled', { name: uninstallPlan.name }))
      setUninstallPlan(null)
      navigate(routes.view.plugins())
    } catch (error) {
      toast.error(t('pluginsList.uninstallFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setUninstallBusy(false)
    }
  }, [uninstallPlan, workspaceId, t])

  const titleMenu = plugin ? (
    <PluginMenu
      onSendToWorkspace={workspaces.length > 1 ? () => setSendOpen(true) : undefined}
      onShowInFinder={handleReveal}
      onUninstall={requestUninstall}
      canShowInFinder={canRevealLocally}
    />
  ) : undefined

  return (
    <>
      <Info_Page
        loading={false}
        empty={!plugin ? t('pluginsList.pluginNotFound', { name: pluginName }) : undefined}
      >
        <Info_Page.Header title={plugin?.name ?? pluginName} titleMenu={titleMenu} />

        {plugin && (
          <Info_Page.Content>
            <Info_Page.Hero
              avatar={
                // Same tile treatment the sidebar rows use: bg-foreground/5 with a
                // muted glyph, so the hero and the list row read as one thing.
                <PluginAvatar plugin={plugin} workspaceId={workspaceId} fluid />
              }
              title={plugin.name}
              tagline={plugin.description}
            />

            <Info_Section
              title={t('pluginsList.manifest')}
              actions={
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('plugin-manifest', plugin.path)}
                  secondaryAction={{ label: t('common.editFile'), filePath: `${plugin.path}/plugin.json` }}
                />
              }
            >
              <Info_Table>
                <Info_Table.Row label={t('common.name')} value={plugin.name} />
                {plugin.version && <Info_Table.Row label={t('pluginsList.version')} value={plugin.version} />}
                {plugin.author && <Info_Table.Row label={t('pluginsList.author')} value={plugin.author} />}
                {plugin.license && <Info_Table.Row label={t('pluginsList.license')} value={plugin.license} />}
                {plugin.homepage && <Info_Table.Row label={t('pluginsList.homepage')} value={plugin.homepage} />}
                <Info_Table.Row label={t('common.location')}>
                  <button onClick={handleReveal} className="hover:underline cursor-pointer text-left">
                    {plugin.workspaceRelativePath}
                  </button>
                </Info_Table.Row>
              </Info_Table>
            </Info_Section>

            <Info_Section
              title={t('pluginsList.promptFragment')}
              description={t('pluginsList.promptDescription')}
              actions={
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('plugin-prompt', plugin.path)}
                  secondaryAction={{ label: t('common.editFile'), filePath: `${plugin.path}/PROMPT.md` }}
                />
              }
            >
              <Info_Markdown maxHeight={540} fullscreen>
                {plugin.promptFragment || t('pluginsList.promptAbsent')}
              </Info_Markdown>
            </Info_Section>

            <Info_Section
              title={t('pluginsList.skillsTitle')}
              description={t('pluginsList.skillsDescription')}
            >
              {plugin.skills.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">{t('pluginsList.noContributedSkills')}</p>
              ) : (
                <div className="rounded-[8px] border border-border/50 divide-y divide-border/30 overflow-hidden">
                  {plugin.skills.map((skill) => (
                    <button
                      key={skill.slug}
                      onClick={() => navigate(routes.view.skills(skill.slug))}
                      className="w-full text-left px-3 py-2 hover:bg-foreground/[0.03] transition-colors"
                    >
                      <div className="text-sm font-medium">{skill.name}</div>
                      <div className="text-xs text-muted-foreground">{skill.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </Info_Section>

            <Info_Section
              title={t('pluginsList.sourcesTitle')}
              description={t('pluginsList.sourcesDescription')}
            >
              {plugin.sources.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">{t('pluginsList.noContributedSources')}</p>
              ) : (
                <div className="rounded-[8px] border border-border/50 divide-y divide-border/30 overflow-hidden">
                  {plugin.sources.map((source) => (
                    <button
                      key={source.slug}
                      onClick={() => navigate(routes.view.sources({ sourceSlug: source.slug }))}
                      className="w-full text-left px-3 py-2 hover:bg-foreground/[0.03] transition-colors flex items-center justify-between gap-3"
                    >
                      <span className="text-sm font-medium">{source.slug}</span>
                      <span className="text-xs text-muted-foreground uppercase">{source.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </Info_Section>


            {/* A load warning means part of the bundle was skipped, not that the
                bundle failed — the distinction matters, so it is stated rather
                than folded into a generic error. */}
            {plugin.warnings.length > 0 && (
              <Info_Section title={t('pluginsList.warnings')}>
                <div className="space-y-2">
                  {plugin.warnings.map((warning, index) => (
                    <Info_Alert key={`${warning.path}-${index}`} variant="warning">
                      <span className="font-medium">{warning.path}</span> — {warning.message}
                    </Info_Alert>
                  ))}
                </div>
              </Info_Section>
            )}

          </Info_Page.Content>
        )}
      </Info_Page>

      {plugin && <SendResourceToWorkspaceDialog open={sendOpen} onOpenChange={setSendOpen}
        resourceType="plugin" resourceIds={[plugin.name]} resourceLabel={plugin.name}
        workspaces={workspaces} activeWorkspaceId={workspaceId} />}
      <Dialog open={!!uninstallPlan} onOpenChange={(open) => !open && setUninstallPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pluginsList.uninstallTitle', { name: uninstallPlan?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('pluginsList.uninstallDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 text-muted-foreground">{t('pluginsList.removesNotice')}</p>
              {uninstallPlan && uninstallPlan.removes.length > 0 ? (
                <ul className="list-disc pl-5">
                  {uninstallPlan.removes.map((entry) => (
                    <li key={`${entry.kind}:${entry.slug}`}>{entry.kind}: {entry.slug}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('pluginsList.removesNone')}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-muted-foreground">{t('pluginsList.retainedNotice')}</p>
              {uninstallPlan && uninstallPlan.retains.length > 0 ? (
                <ul className="list-disc pl-5">
                  {uninstallPlan.retains.map((entry) => (
                    <li key={`${entry.kind}:${entry.slug}`}>{entry.kind}: {entry.slug}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('pluginsList.retainsNone')}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUninstallPlan(null)} disabled={uninstallBusy}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmUninstall} disabled={uninstallBusy}>
              {t('pluginsList.uninstallPlugin')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
