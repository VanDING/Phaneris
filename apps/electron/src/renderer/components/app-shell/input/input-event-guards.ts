export interface ImeKeyState {
  isComposing?: boolean
  keyCode?: number
  timeStamp?: number
}

/**
 * True when an Enter press belongs to IME composition and must not submit.
 *
 * WebKit keeps a stale composition flag for a few hundred milliseconds after
 * `compositionend`; the timestamp latch prevents a confirming Enter from
 * sending the message right after the candidate window closes.
 */
export function isImeSubmitBlocked(event: ImeKeyState, lastCompositionEndAt: number): boolean {
  if (event.isComposing || event.keyCode === 229) return true
  const webKit = typeof navigator !== 'undefined'
    && /AppleWebKit/.test(navigator.userAgent)
    && !/Chrome|Chromium|Edg/.test(navigator.userAgent)
  if (!webKit || !event.timeStamp) return false
  return Math.abs(event.timeStamp - lastCompositionEndAt) < 500
}

export interface ScopedInputEventTarget {
  sessionId?: string | null
  isFocusedPanel: boolean
  targetSessionId?: string
}

/**
 * Decide whether an input-affecting custom event should be handled by
 * this FreeFormInput instance.
 */
export function shouldHandleScopedInputEvent({
  sessionId,
  isFocusedPanel,
  targetSessionId,
}: ScopedInputEventTarget): boolean {
  if (targetSessionId) {
    return targetSessionId === sessionId
  }
  return isFocusedPanel
}

export interface RecallPromptArrowUpState {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing: boolean
  isProcessing: boolean
  input: string
  attachmentCount: number
  loadingAttachmentCount: number
  followUpItemCount: number
  inlineMenuOpen: boolean
  disabled: boolean
  disableSend: boolean
}

/**
 * Plain Arrow Up recalls/cancels only when there is truly no editable draft.
 * Whitespace, attachments, loading files, and follow-up context are all content.
 */
export function shouldRecallPromptOnArrowUp({
  key,
  shiftKey,
  metaKey,
  ctrlKey,
  altKey,
  isComposing,
  isProcessing,
  input,
  attachmentCount,
  loadingAttachmentCount,
  followUpItemCount,
  inlineMenuOpen,
  disabled,
  disableSend,
}: RecallPromptArrowUpState): boolean {
  return key === 'ArrowUp'
    && !shiftKey
    && !metaKey
    && !ctrlKey
    && !altKey
    && !isComposing
    && isProcessing
    && !disabled
    && !disableSend
    && input === ''
    && attachmentCount === 0
    && loadingAttachmentCount === 0
    && followUpItemCount === 0
    && !inlineMenuOpen
}
