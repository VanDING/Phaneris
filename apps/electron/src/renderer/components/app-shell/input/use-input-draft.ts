import { useCallback, useEffect, useRef, useState } from 'react'
import { coerceInputText } from '@/lib/input-text'
import { registerInputDraftFlush } from '@/lib/input-draft-flush'

/** One composer owns its draft timer and its final flush to the current product callback. */
export function useInputDraft(inputValue: string | undefined, onInputChange?: (value: string) => void) {
  const [input, setInput] = useState(() => coerceInputText(inputValue))
  const prevInputValueRef = useRef(coerceInputText(inputValue))
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef(input)
  inputRef.current = input
  useEffect(() => {
    if (inputValue === undefined) return
    const next = coerceInputText(inputValue)
    if (next !== prevInputValueRef.current) { setInput(next); prevInputValueRef.current = next }
  }, [inputValue])
  const syncToParent = useCallback((value: string) => {
    if (!onInputChange) return
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => { onInputChange(value); prevInputValueRef.current = value }, 300)
  }, [onInputChange])
  const flushToParent = useCallback(() => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    if (onInputChange && inputRef.current !== prevInputValueRef.current) {
      onInputChange(inputRef.current)
      prevInputValueRef.current = inputRef.current
    }
  }, [onInputChange])
  useEffect(() => {
    const release = registerInputDraftFlush(flushToParent)
    return () => { release(); flushToParent() }
  }, [flushToParent])
  const clearInputDraft = useCallback(() => {
    setInput('')
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.(''); prevInputValueRef.current = ''
  }, [onInputChange])
  const consumeInputDraftSnapshot = useCallback(() => {
    const snapshot = input.trim(); clearInputDraft(); return snapshot
  }, [input, clearInputDraft])
  return { input, setInput, inputRef, prevInputValueRef, syncTimeoutRef, syncToParent, clearInputDraft, consumeInputDraftSnapshot }
}
