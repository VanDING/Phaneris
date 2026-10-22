/**
 * Restoring a composer draft after a refused send.
 *
 * Kept outside the component so the rule is stated once: a draft is put back only
 * for the session it was typed on, and only where the user has not typed since.
 * The composer clears optimistically (the send acknowledgement is not a reason to
 * keep the text in the field), so this is the other half of that decision.
 */
import type { FileAttachment } from '../../../../shared/types'

export interface RejectedDraftContext {
  /** Text that was submitted. */
  text: string
  /** Attachments that were submitted. */
  attachments: FileAttachment[]
  /** Session the draft was typed on. */
  submittedSession: string | undefined
  /** Session the composer is showing now. */
  currentSession: string | undefined
  /** What the field holds right now. */
  currentInput: string
  /** What the attachment list holds right now. */
  currentAttachments: FileAttachment[]
  setInput: (value: string) => void
  syncToParent: (value: string) => void
  setAttachments: (value: FileAttachment[]) => void
  onAttachmentsChange?: (value: FileAttachment[]) => void
}

export function restoreRejectedDraft(context: RejectedDraftContext): void {
  // A workspace or session switch owns the composer now; the draft belongs to
  // the surface it was typed on.
  if (context.submittedSession !== context.currentSession) return
  if (!context.currentInput.trim()) {
    context.setInput(context.text)
    context.syncToParent(context.text)
  }
  if (context.attachments.length > 0) {
    const restored = [...context.attachments, ...context.currentAttachments]
    context.setAttachments(restored)
    context.onAttachmentsChange?.(restored)
  }
}
