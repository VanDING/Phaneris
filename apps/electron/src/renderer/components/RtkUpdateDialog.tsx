/**
 * rtk update prompt.
 *
 * rtk releases before `minSafeVersion` corrupt the output the agent reads
 * (grep lines with a colon, `wc` input redirects, crashes on piped output), so
 * the app stops routing commands through them. This dialog says so and hands
 * the user the upstream update command. `RtkUpdatePrompt` opens it on its own
 * once per outdated version while Token Optimization is on; the AI settings
 * page opens `RtkUpdateDialog` directly.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRegisterModal } from '@/context/ModalContext'

export interface RtkStatusInfo {
  installed: boolean
  path: string | null
  version: string | null
  outdated: boolean
  minSafeVersion: string
  foundPath: string | null
  updateCommand: string
}

/** Keep the UI-only dismissal in Phaneris's native preferences file. */
async function readPromptPreferences(): Promise<Record<string, unknown> | null> {
  try {
    const result = await window.electronAPI.readPreferences()
    const preferences: unknown = result.content.trim() ? JSON.parse(result.content) : {}
    return preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? preferences as Record<string, unknown> : null
  } catch (error) {
    console.error('[RtkUpdatePrompt] Failed to read preferences:', error)
    return null
  }
}

async function rememberDismissedVersion(version: string): Promise<void> {
  const preferences = await readPromptPreferences()
  if (!preferences) return // Keep malformed or unavailable preferences untouched.
  const result = await window.electronAPI.writePreferences(JSON.stringify({ ...preferences, rtkUpdateDismissedVersion: version }, null, 2))
  if (!result.success) throw new Error(result.error ?? 'Failed to save RTK prompt preference')
}

interface RtkUpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: RtkStatusInfo
  /** Called with the fresh status after Re-check. */
  onStatusChange?: (status: RtkStatusInfo) => void
  /** "Later" remembers the version so the automatic prompt stays quiet. */
  onDismiss?: () => void
}

export function RtkUpdateDialog({ open, onOpenChange, status, onStatusChange, onDismiss }: RtkUpdateDialogProps) {
  const { t } = useTranslation()
  const [rechecking, setRechecking] = React.useState(false)
  useRegisterModal(open, () => onOpenChange(false))

  const copyCommand = React.useCallback(() => {
    navigator.clipboard.writeText(status.updateCommand).then(
      () => toast.success(t('rtkUpdate.copied')),
      () => toast.error(t('rtkUpdate.copyFailed')),
    )
  }, [status.updateCommand, t])

  const recheck = React.useCallback(async () => {
    setRechecking(true)
    try {
      const fresh = await window.electronAPI?.getRtkStatus({ forceRecheck: true })
      if (!fresh) return
      onStatusChange?.(fresh)
      if (fresh.path && !fresh.outdated) {
        toast.success(t('rtkUpdate.updated', { version: fresh.version ?? '' }))
        onOpenChange(false)
      } else if (fresh.outdated) {
        toast.error(t('rtkUpdate.stillOutdated', { version: fresh.version ?? '' }))
      } else {
        toast.error(t('settings.ai.rtk.notInstalledDesc'))
      }
    } catch {
      toast.error(t('rtkUpdate.checkFailed'))
    } finally {
      setRechecking(false)
    }
  }, [onOpenChange, onStatusChange, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('rtkUpdate.title')}</DialogTitle>
          <DialogDescription>
            {t('rtkUpdate.body', { version: status.version ?? '?', min: status.minSafeVersion })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="text-foreground/80">{t('rtkUpdate.instructions')}</p>
          <pre className="rounded-lg bg-foreground/5 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all select-all">{status.updateCommand}</pre>
          {status.foundPath && (
            <p className="text-xs text-foreground/60">{t('rtkUpdate.foundAt', { path: status.foundPath })}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => { onDismiss?.(); onOpenChange(false) }}
          >
            {t('rtkUpdate.later')}
          </Button>
          <Button variant="outline" onClick={copyCommand}>{t('rtkUpdate.copy')}</Button>
          <Button onClick={() => { void recheck() }} disabled={rechecking}>
            {rechecking ? t('common.checking') : t('rtkUpdate.recheck')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Opens the update dialog once per outdated rtk version while Token Optimization
 * is on. Checks on mount and when the workspace (and so possibly the server) changes.
 */
export function RtkUpdatePrompt({ workspaceId }: { workspaceId?: string | null }) {
  const [status, setStatus] = React.useState<RtkStatusInfo | null>(null)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!workspaceId || typeof window.electronAPI?.getRtkStatus !== 'function') return
    let cancelled = false
    void (async () => {
      try {
        const [enabled, current, preferences] = await Promise.all([window.electronAPI.getRtkEnabled(), window.electronAPI.getRtkStatus(), readPromptPreferences()])
        if (cancelled || !enabled || !current.outdated) return
        if (preferences?.rtkUpdateDismissedVersion === current.version) return
        setStatus(current)
        setOpen(true)
      } catch (error) {
        console.error('[RtkUpdatePrompt] Failed to check rtk status:', error)
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId])

  if (!status) return null
  return (
    <RtkUpdateDialog
      open={open}
      onOpenChange={setOpen}
      status={status}
      onStatusChange={setStatus}
      onDismiss={() => {
        if (status.version) void rememberDismissedVersion(status.version).catch(error => console.error('[RtkUpdatePrompt] Failed to save dismissal:', error))
      }}
    />
  )
}
