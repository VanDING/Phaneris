import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRegisterModal } from "@/context/ModalContext"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Label of the committing button (right-most). */
  confirmLabel: string
  /** Label of the dismissing button. Defaults to `common.cancel`. */
  cancelLabel?: string
  /**
   * `destructive` styles the commit button red. Use it for anything that
   * deletes, discards or otherwise cannot be undone — the whole point of this
   * component is that those actions stop looking like a browser `confirm()`.
   */
  variant?: "destructive" | "default"
  onConfirm: () => void
  /** Disables both buttons and shows the commit button in its loading state. */
  busy?: boolean
  /**
   * Optional middle action, rendered between cancel and confirm. Only for
   * genuinely tri-state prompts; prefer a plain two-button confirm.
   */
  extraLabel?: string
  onExtra?: () => void
}

/**
 * ConfirmDialog — the app's styled replacement for `window.confirm()`.
 *
 * Three hand-rolled copies of this footer already existed
 * (`pages/DeletePageDialog`, the inline automation delete in `AppShell`, and
 * `ResetConfirmationDialog`); this is the shared version. Declarative and
 * stateless — the caller owns `open`.
 *
 * For call sites that want `window.confirm()` ergonomics, use the imperative
 * `confirmDialog()` from `components/ConfirmDialogHost` instead, which renders
 * this component for you.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  busy = false,
  extraLabel,
  onExtra,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  // Register with the modal registry so Cmd+W / the window X close this dialog
  // before they reach the panels or the window itself.
  useRegisterModal(open, () => onOpenChange(false))

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          {extraLabel && onExtra ? (
            <Button variant="outline" onClick={onExtra} disabled={busy}>
              {extraLabel}
            </Button>
          ) : null}
          <Button variant={variant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
