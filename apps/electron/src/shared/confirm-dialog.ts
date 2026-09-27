/**
 * Wire shape for a server-requested confirmation dialog.
 *
 * Structural mirror of `ConfirmDialogSpec` in
 * `packages/server-core/src/transport/capabilities.ts`, for the two layers that
 * cannot import the server package directly:
 *
 * - `preload/bootstrap.ts` can, and does, use the canonical type — it needs the
 *   capability constants from there anyway.
 * - `shared/types.ts` and the renderer cannot, without dragging a server
 *   package into the renderer bundle.
 *
 * It is a plain JSON shape crossing a process boundary, so the mirror is safe.
 * Keep the two in step when the spec grows.
 */
export interface ClientConfirmSpec {
  type?: 'none' | 'info' | 'warning' | 'error' | 'question'
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
  /**
   * Optional localization descriptor. When a server sends this, the client
   * renders translated copy (and a styled destructive button) instead of the
   * English fallback strings in `title` / `message` / `buttons`. Servers that
   * omit it still get a usable dialog, just in English.
   */
  i18n?: {
    titleKey: string
    messageKey: string
    detailKey?: string
    confirmKey: string
    cancelKey?: string
    values?: Record<string, string | number>
  }
}

/** Payload pushed from the main process to the renderer's confirm host. */
export interface ConfirmDialogRequestPayload {
  id: string
  spec: ClientConfirmSpec
}
