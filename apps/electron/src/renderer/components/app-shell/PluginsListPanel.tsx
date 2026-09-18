import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Shapes, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { pluginSelection } from '@/hooks/useEntitySelection'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { PluginMenu } from './PluginMenu'
import type { PluginLoadError, PluginSummary, PluginUninstallPlan, PluginsListResult } from '../../../shared/types'

/**
 * One row of the section.
 *
 * Broken bundles get a row of their own rather than being dropped: a directory
 * that fails to load must stay visible, otherwise the user sees a plugin
 * disappear and concludes the install failed (design §7, plugins:list contract).
 */
type PluginRow =
  | { kind: 'plugin'; id: string; plugin: PluginSummary }
  | { kind: 'error'; id: string; error: PluginLoadError }

export interface PluginsListPanelProps {
  /** Active workspace; the uninstall RPCs are workspace-scoped. */
  workspaceId?: string
  /**
   * Installed bundles, supplied by the shell.
   *
   * The shell already loads this list for the `/` roster and already subscribes
   * to `plugins:changed`, so fetching again here would mean two RPC calls and two
   * subscriptions describing the same directory — and two chances to disagree
   * about it.
   */
  plugins?: PluginSummary[]
  /** Bundles present on disk that failed to load; rendered, never hidden. */
  loadErrors?: PluginLoadError[]
  /** Force a refetch — used after an uninstall so the row disappears promptly. */
  onReload?: () => void | Promise<void>
  /** Open a bundle's own page in the content panel (mirrors Skills/Sources). */
  onPluginClick?: (plugin: PluginSummary) => void
  /** Name of the bundle whose page is open, so its row shows selected. */
  selectedPluginName?: string | null
  className?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * PluginsListPanel - the Plugins sidebar section.
 *
 * Two-level like Sources and Skills: this list selects a bundle, and the bundle
 * gets its own page in the content panel. Its contributed skills/sources are
 * summarized there and linked into the native sections, which stay their owners
 * (design P7-2). Installing is docs-driven, so there is no install affordance —
 * only reveal and uninstall.
 */
export function PluginsListPanel({
  workspaceId,
  plugins = [],
  loadErrors = [],
  onReload,
  onPluginClick,
  selectedPluginName,
  className,
}: PluginsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer

  const [uninstallPlan, setUninstallPlan] = React.useState<PluginUninstallPlan | null>(null)
  const [uninstallBusy, setUninstallBusy] = React.useState(false)

  const rows = React.useMemo((): PluginRow[] => {
    const pluginRows = plugins.map<PluginRow>((plugin) => ({
      kind: 'plugin',
      id: `plugin:${plugin.name}`,
      plugin,
    }))
    const errorRows = loadErrors.map<PluginRow>((error, index) => ({
      kind: 'error',
      id: `error:${index}:${error.path}`,
      error,
    }))
    return [...pluginRows, ...errorRows]
  }, [plugins, loadErrors])

  const revealPlugin = React.useCallback(async (pluginPath: string) => {
    if (!canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(pluginPath)
    } catch (error) {
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
        description: errorMessage(error),
      })
    }
  }, [canRevealLocally, t])

  // D10 phase 1 — compute the plan (what goes, what another plugin still
  // claims) before showing anything, so the confirmation is not a client-side
  // guess about what the uninstall will do.
  const requestUninstall = React.useCallback(async (pluginName: string) => {
    if (!workspaceId) return
    try {
      setUninstallPlan(await window.electronAPI.analyzePluginUninstall(workspaceId, pluginName))
    } catch (error) {
      toast.error(t('pluginsList.uninstallFailed'), { description: errorMessage(error) })
    }
  }, [workspaceId, t])

  // D10 phase 2 — run the approved plan.
  const confirmUninstall = React.useCallback(async () => {
    if (!workspaceId || !uninstallPlan) return
    const pluginName = uninstallPlan.name
    setUninstallBusy(true)
    try {
      await window.electronAPI.uninstallPlugin(workspaceId, pluginName)
      toast.success(t('pluginsList.uninstalled', { name: pluginName }))
      setUninstallPlan(null)
      // The backend also pushes `plugins:changed`; this just makes the row go
      // away immediately instead of after a round trip.
      await onReload?.()
    } catch (error) {
      toast.error(t('pluginsList.uninstallFailed'), { description: errorMessage(error) })
    } finally {
      setUninstallBusy(false)
    }
  }, [workspaceId, uninstallPlan, onReload, t])

  return (
    <>
    <EntityPanel<PluginRow>
      items={rows}
      getId={(row) => row.id}
      selection={pluginSelection}
      selectedId={selectedPluginName ? `plugin:${selectedPluginName}` : null}
      onItemClick={(row) => {
        // Only a loaded bundle has a page; an unloadable one has nothing to show
        // beyond the error already rendered in its row.
        if (row.kind === 'plugin') onPluginClick?.(row.plugin)
      }}
      className={className}
      containerProps={{ 'data-list-role': 'plugins' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<Shapes />}
          title={t('pluginsList.noPluginsConfigured')}
          description={t('pluginsList.emptyDescription')}
          docKey="plugins"
        />
      }
      mapItem={(row) => {
        if (row.kind === 'error') {
          return {
            icon: <TriangleAlert />,
            title: <span className="text-destructive">{t('pluginsList.brokenPlugin')}</span>,
            subtitle: row.error.message,
            badges: (
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {row.error.path}
              </span>
            ),
          }
        }

        const { plugin } = row
        return {
          icon: <Shapes />,
          title: plugin.name,
          subtitle: (plugin.skills.length > 0 || plugin.sources.length > 0) ? (
            <span className="flex flex-col">
              {plugin.skills.length > 0 && (
                <span className="truncate">
                  {t('pluginsList.contributedSkills', { slugs: plugin.skills.map((skill) => skill.slug).join(', ') })}
                </span>
              )}
              {plugin.sources.length > 0 && (
                <span className="truncate">
                  {t('pluginsList.contributedSources', { slugs: plugin.sources.map((source) => source.slug).join(', ') })}
                </span>
              )}
            </span>
          ) : undefined,
          badges: (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
                {t('pluginsList.pluginBadge')}
              </span>
              <span className="truncate">{plugin.description}</span>
            </span>
          ),
          trailing: plugin.version ? (
            <span className="text-[10px] text-muted-foreground">{plugin.version}</span>
          ) : undefined,
          menu: (
            <PluginMenu
              onShowInFinder={() => revealPlugin(plugin.path)}
              canShowInFinder={canRevealLocally}
              onUninstall={() => { void requestUninstall(plugin.name) }}
            />
          ),
        }
      }}
    />

    {/* Uninstall confirmation (D10) — shows both halves of the plan: what this
        bundle owns alone, and what another installed plugin still references. */}
    <Dialog
      open={uninstallPlan !== null}
      onOpenChange={(open) => { if (!open) setUninstallPlan(null) }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('pluginsList.uninstallTitle', { name: uninstallPlan?.name })}</DialogTitle>
          <DialogDescription>{t('pluginsList.uninstallDescription')}</DialogDescription>
        </DialogHeader>

        {uninstallPlan && (
          <div className="flex flex-col gap-3 text-xs">
            <section className="flex flex-col gap-1">
              <p className="font-medium">{t('pluginsList.removesNotice')}</p>
              {uninstallPlan.removes.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {uninstallPlan.removes.map((entry) => (
                    <li key={`remove:${entry.kind}:${entry.slug}`} className="truncate">
                      {entry.kind}: {entry.slug}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('pluginsList.removesNone')}</p>
              )}
            </section>

            <section className="flex flex-col gap-1">
              <p className="font-medium">{t('pluginsList.retainedNotice')}</p>
              {uninstallPlan.retains.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {uninstallPlan.retains.map((entry) => (
                    <li key={`retain:${entry.kind}:${entry.slug}`} className="truncate">
                      {entry.kind}: {entry.slug}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('pluginsList.retainsNone')}</p>
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setUninstallPlan(null)} disabled={uninstallBusy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => { void confirmUninstall() }} disabled={uninstallBusy}>
            {t('pluginsList.uninstallPlugin')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
