/**
 * ArtifactsPanel - Files > Artifacts.
 *
 * The delivery surface for this session: artifacts the agent drafted or that
 * were opened and accepted here. `current` entries are preview registrations
 * created merely by opening an existing file, so the default filter keeps them
 * out; the status filter is the opt-in way to see everything the store holds.
 *
 * Actions mirror the chat's artifact cards (accept / discard / revise) but the
 * full editing workflow stays in the Artifact workbench.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronDown, Eye, FilePenLine, Package, RotateCcw, Trash2 } from 'lucide-react'
import type { ArtifactDescriptor, ResolvedArtifact } from '@phaneris/shared/artifacts/browser'
import { cn } from '@/lib/utils'
import { Spinner } from '@phaneris/ui'
import { confirmDialog } from '@/components/ConfirmDialogHost'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PanelEmptyState } from './PanelEmptyState'
import { useArtifacts } from '@/hooks/useArtifacts'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { artifactsStatusFilterAtom, type ArtifactStatusFilter } from '@/atoms/content-panel-ui'
import { getPathBasename } from '@/lib/platform'

const STATUS_BADGE: Record<ArtifactDescriptor['status'], string> = {
  ready: 'bg-info/12 text-info-text',
  accepted: 'bg-success/12 text-success-text',
  conflict: 'bg-destructive/10 text-destructive',
  draft: 'bg-primary/10 text-primary',
  current: 'bg-foreground/8 text-muted-foreground',
  discarded: 'bg-foreground/8 text-muted-foreground',
}

/** Review-worthy states sort first; preview registrations sink to the bottom. */
const STATUS_ORDER: Record<ArtifactDescriptor['status'], number> = {
  conflict: 0,
  ready: 1,
  draft: 2,
  accepted: 3,
  current: 4,
  discarded: 5,
}

const ACTIONABLE_STATUSES: ReadonlySet<ArtifactDescriptor['status']> = new Set(['draft', 'ready', 'conflict'])

function matchesFilter(artifact: ArtifactDescriptor, filter: ArtifactStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'current') return artifact.status === 'current'
  return artifact.status !== 'current'
}

function ArtifactRow({
  resolved,
  busy,
  onOpen,
  onAccept,
  onDiscard,
  onRevise,
}: {
  resolved: ResolvedArtifact
  busy: boolean
  onOpen: () => void
  onAccept: () => void
  onDiscard: () => void
  onRevise: () => void
}) {
  const { t } = useTranslation()
  const { artifact } = resolved
  const badge = STATUS_BADGE[artifact.status]
  return (
    <li className="overflow-hidden rounded-xl border border-border/70 bg-background/60 shadow-minimal">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onOpen}
          title={artifact.sourcePath}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <FilePenLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-body font-medium">{artifact.title}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold', badge)}>
            {t(`artifact.status.${artifact.status}`)}
          </span>
        </button>
        <span className="hidden shrink-0 truncate text-meta text-muted-foreground @min-[560px]/files:block @min-[560px]/files:max-w-[16rem]">
          {getPathBasename(artifact.sourcePath) || artifact.sourcePath}
        </span>
        {ACTIONABLE_STATUSES.has(artifact.status) && (
          <span className="flex shrink-0 items-center gap-1">
            {artifact.status === 'ready' && (
              <button
                type="button"
                disabled={busy}
                onClick={onRevise}
                aria-label={t('artifact.revise')}
                title={t('artifact.revise')}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onDiscard}
              aria-label={t('artifact.discard')}
              title={t('artifact.discard')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {artifact.status === 'ready' && (
              <button
                type="button"
                disabled={busy}
                onClick={onAccept}
                aria-label={t('artifact.accept')}
                title={t('artifact.accept')}
                className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-meta font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                <Check className="h-3 w-3" />
                {t('artifact.accept')}
              </button>
            )}
          </span>
        )}
      </div>
    </li>
  )
}

export function ArtifactsPanel({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const [statusFilter, setStatusFilter] = useAtom(artifactsStatusFilterAtom)
  const [busyId, setBusyId] = useState<string | null>(null)
  const artifactStore = useArtifacts(activeWorkspaceId ?? null, sessionId)

  const visible = useMemo(() => artifactStore.artifacts
    .filter(({ artifact }) => matchesFilter(artifact, statusFilter))
    .sort((left, right) => {
      const order = STATUS_ORDER[left.artifact.status] - STATUS_ORDER[right.artifact.status]
      return order !== 0 ? order : right.artifact.updatedAt - left.artifact.updatedAt
    }), [artifactStore.artifacts, statusFilter])

  const currentCount = useMemo(
    () => artifactStore.artifacts.filter(({ artifact }) => artifact.status === 'current').length,
    [artifactStore.artifacts],
  )

  // Per-scope counts for the filter menu: the number a user needs to decide
  // whether switching scope will show anything.
  const counts = useMemo(() => ({
    delivered: artifactStore.artifacts.filter(({ artifact }) => matchesFilter(artifact, 'delivered')).length,
    all: artifactStore.artifacts.length,
    current: currentCount,
  }) as Record<ArtifactStatusFilter, number>, [artifactStore.artifacts, currentCount])

  const open = useCallback((artifactId: string) => {
    navigate(routes.view.artifact(artifactId))
  }, [])

  const run = useCallback(async (artifactId: string, action: () => Promise<unknown>) => {
    setBusyId(artifactId)
    try {
      await action()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    } finally {
      setBusyId(null)
    }
  }, [t])

  const accept = useCallback((artifactId: string) => run(artifactId, async () => {
    const result = await artifactStore.accept(artifactId)
    if (result.accepted) toast.success(t('artifact.accepted'))
    else toast.error(t('artifact.conflictDetected'))
  }), [artifactStore, run, t])

  const discard = useCallback(async (artifactId: string) => {
    const confirmed = await confirmDialog({
      title: t('artifact.discardConfirm'),
      confirmLabel: t('artifact.discard'),
    })
    if (!confirmed) return
    await run(artifactId, () => artifactStore.discard(artifactId))
  }, [artifactStore, run, t])

  const revise = useCallback((artifactId: string) => run(artifactId, () => artifactStore.revise(artifactId)), [artifactStore, run])

  const filters: ReadonlyArray<{ id: ArtifactStatusFilter; label: string }> = [
    { id: 'delivered', label: t('contentPanel.files.artifacts.filter.delivered') },
    { id: 'all', label: t('contentPanel.files.artifacts.filter.all') },
    { id: 'current', label: t('contentPanel.files.artifacts.filter.current') },
  ]
  const activeFilter = filters.find(filter => filter.id === statusFilter) ?? filters[0]!

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One menu, not three competing chips. The old row was a third selection
          grammar inside the panel (`aria-pressed` pills) whose subordinate
          "current" filter rendered larger than the view tabs above it. The
          trigger states the active filter and the menu carries a count per
          scope, so choosing a filter costs a menu, not a permanent row. */}
      {artifactStore.artifacts.length > 0 && (
        <div className="flex h-control-lg shrink-0 items-center gap-2 border-b border-border/50 bg-background px-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('contentPanel.files.artifacts.filterLabel')}
                className="craft-segment craft-focus flex items-center gap-1 px-1 text-meta font-medium text-text-secondary hover:text-foreground"
              >
                {activeFilter.label}
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {filters.map(filter => (
                <DropdownMenuItem key={filter.id} onSelect={() => setStatusFilter(filter.id)}>
                  <Check
                    className={cn('h-3.5 w-3.5 shrink-0', statusFilter === filter.id ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  {filter.label}
                  <span className="ml-auto pl-3 text-meta tabular-nums text-text-secondary">{counts[filter.id]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto shrink-0 text-meta tabular-nums text-text-secondary" data-testid="artifacts-count">
            {visible.length}
          </span>
        </div>
      )}

      {artifactStore.isLoading && artifactStore.artifacts.length === 0 ? (
        <div className="flex h-full items-center justify-center"><Spinner /></div>
      ) : artifactStore.error ? (
        <PanelEmptyState title={artifactStore.error} icon={<AlertTriangle className="h-6 w-6" />} />
      ) : visible.length === 0 ? (
        <PanelEmptyState
          title={statusFilter === 'delivered'
            ? t('contentPanel.files.artifacts.empty')
            : t('contentPanel.files.artifacts.emptyFiltered')}
          hint={statusFilter === 'delivered' ? t('contentPanel.files.artifacts.emptyHint') : undefined}
          icon={<Eye className="h-6 w-6" />}
        />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto bg-foreground/[0.02] p-2.5" aria-label={t('contentPanel.files.view.artifacts')}>
          <ul className="flex flex-col gap-2">
            {visible.map((resolved) => (
              <ArtifactRow
                key={resolved.artifact.id}
                resolved={resolved}
                busy={busyId === resolved.artifact.id}
                onOpen={() => open(resolved.artifact.id)}
                onAccept={() => accept(resolved.artifact.id)}
                onDiscard={() => void discard(resolved.artifact.id)}
                onRevise={() => revise(resolved.artifact.id)}
              />
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
