/**
 * ConfirmDialogHost — the app's single in-app confirmation surface.
 *
 * Two kinds of confirmation land here, and both used to reach the OS:
 *
 * 1. Renderer-local prompts, via the imperative `confirmDialog()` helper. This
 *    is the drop-in replacement for `window.confirm()` — same ergonomics
 *    (`if (!(await confirmDialog({...}))) return`), styled dialog instead of
 *    Chromium's chrome.
 *
 * 2. Server-requested prompts, via the `client:confirmDialog` capability. A
 *    remote (or embedded) server asks *the client* to confirm something — for
 *    example deleting a conversation — and used to get a native Windows
 *    message box. Those now render here too.
 *
 * The host is deliberately a singleton: one request at a time, queued in order,
 * so a burst of destructive prompts cannot stack up and lose the user's place.
 * Mount it once, inside `ModalProvider` so Cmd+W closes the dialog before it
 * closes the window.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ClientConfirmSpec } from '../../shared/confirm-dialog'

export type { ClientConfirmSpec }

/** One renderer-local confirmation request. */
export interface LocalConfirmRequest {
  title: string
  description?: string
  /** Label of the committing button. */
  confirmLabel: string
  /** Defaults to `common.cancel`. */
  cancelLabel?: string
  /** Optional middle action — see `ConfirmDialogProps.extraLabel`. */
  extraLabel?: string
  /** `destructive` styles the commit button red. Defaults to `destructive`. */
  variant?: 'destructive' | 'default'
}

interface QueuedRequest extends LocalConfirmRequest {
  /** Number of buttons this request renders (2, or 3 when `extraLabel` is set). */
  buttonCount: number
  resolve: (index: number) => void
}

// ---------------------------------------------------------------------------
// Imperative queue — module scope so call sites need no provider or hook.
// ---------------------------------------------------------------------------

const queue: QueuedRequest[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function enqueue(request: LocalConfirmRequest): Promise<number> {
  return new Promise<number>((resolve) => {
    queue.push({
      ...request,
      buttonCount: request.extraLabel ? 3 : 2,
      resolve,
    })
    emit()
  })
}

/**
 * Styled replacement for `window.confirm()`.
 *
 * @returns `true` when the user chose the committing button, `false` when they
 * cancelled or dismissed the dialog.
 */
export async function confirmDialog(request: LocalConfirmRequest): Promise<boolean> {
  const index = await enqueue(request)
  return index === (request.extraLabel ? 2 : 1)
}

/**
 * Tri-state variant of {@link confirmDialog}: resolves to the index of the
 * button that was chosen — `0` dismiss, `1` the extra action, `2` commit.
 * `-1` means the request was withdrawn without an answer.
 */
export async function confirmDialogChoice(request: LocalConfirmRequest): Promise<number> {
  return enqueue(request)
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

interface SpecView {
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  extraLabel?: string
  variant: 'destructive' | 'default'
  confirmIndex: number
  extraIndex: number
}

export function ConfirmDialogHost() {
  const { t } = useTranslation()
  const [local, setLocal] = useState<QueuedRequest | null>(null)
  const [spec, setSpec] = useState<{ id: string; spec: ClientConfirmSpec } | null>(null)

  const respond = useCallback((id: string, index: number) => {
    void window.electronAPI?.respondConfirmDialog?.(id, index)
  }, [])

  // Bridge to the main process. A missing bridge (web viewer, older preload)
  // simply means this window never receives server-requested prompts — the
  // main process then keeps the native fallback.
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onConfirmDialogRequest) return
    return api.onConfirmDialogRequest((payload) => {
      setSpec((current) => {
        // A second request while one is on screen would strand the first
        // server-side await. Answer it as cancelled rather than dropping it.
        if (current) respond(current.id, current.spec.cancelId ?? 0)
        return payload
      })
    })
  }, [respond])

  useEffect(() => {
    const sync = () => setLocal(queue[0] ?? null)
    listeners.add(sync)
    sync()
    return () => {
      listeners.delete(sync)
    }
  }, [])

  const settleLocal = useCallback((index: number) => {
    const current = queue.shift()
    if (current) current.resolve(index)
    emit()
  }, [])

  const closeSpec = useCallback(
    (index?: number) => {
      setSpec((current) => {
        if (current) respond(current.id, index ?? current.spec.cancelId ?? 0)
        return null
      })
    },
    [respond],
  )

  /**
   * Button index `0` is always the dismissing action and the last index is
   * always the committing one — that is the contract
   * `requestClientConfirmDialog` documents, and the reason the server can keep
   * asserting `response === 1`.
   */
  const specView = useMemo<SpecView | null>(() => {
    if (!spec) return null
    const { buttons, i18n } = spec.spec
    // Anything beyond a dismiss / optional middle / commit triple has no honest
    // in-app rendering; the main process falls back to the native dialog for
    // those before they ever reach here.
    if (buttons.length < 1 || buttons.length > 3) return null

    const confirmIndex = buttons.length - 1
    const extraIndex = buttons.length === 3 ? 1 : -1
    const detail = i18n?.detailKey
      ? `${t(i18n.messageKey, i18n.values)}\n\n${t(i18n.detailKey, i18n.values)}`
      : i18n
        ? t(i18n.messageKey, i18n.values)
        : [spec.spec.message, spec.spec.detail].filter(Boolean).join('\n\n')

    return {
      title: i18n ? t(i18n.titleKey, i18n.values) : spec.spec.title,
      // `whitespace-pre-line` because both the spec's message/detail pair and
      // the localized message/detail pair are multi-paragraph by construction.
      description: <span className="whitespace-pre-line">{detail}</span>,
      confirmLabel: i18n?.confirmKey ? t(i18n.confirmKey, i18n.values) : (buttons[confirmIndex] ?? ''),
      cancelLabel: i18n?.cancelKey ? t(i18n.cancelKey, i18n.values) : (buttons[0] ?? ''),
      extraLabel: extraIndex >= 0 ? buttons[extraIndex] : undefined,
      // `warning` is what a server sends for "this cannot be undone", so it
      // maps to the destructive treatment; everything else stays neutral.
      variant:
        spec.spec.type === 'warning' || spec.spec.type === 'error' ? 'destructive' : 'default',
      confirmIndex,
      extraIndex,
    }
  }, [spec, t])

  return (
    <>
      <ConfirmDialog
        open={local !== null}
        onOpenChange={(open) => {
          if (!open) settleLocal(0)
        }}
        title={local?.title ?? ''}
        description={local?.description}
        confirmLabel={local?.confirmLabel ?? ''}
        cancelLabel={local?.cancelLabel}
        extraLabel={local?.extraLabel}
        variant={local?.variant ?? 'destructive'}
        onConfirm={() => settleLocal(local ? local.buttonCount - 1 : 1)}
        onExtra={() => settleLocal(1)}
      />

      {specView ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) closeSpec()
          }}
          title={specView.title}
          description={specView.description}
          confirmLabel={specView.confirmLabel}
          cancelLabel={specView.cancelLabel}
          extraLabel={specView.extraLabel}
          variant={specView.variant}
          onConfirm={() => closeSpec(specView.confirmIndex)}
          onExtra={() => closeSpec(specView.extraIndex)}
        />
      ) : null}
    </>
  )
}
