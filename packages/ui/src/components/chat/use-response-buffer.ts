import { useEffect, useReducer, useRef } from 'react'
import { BUFFER_CONFIG, shouldShowContent } from './response-buffering'

/** The deadline must repaint even when the provider pauses after a short fragment. */
export function useResponseBuffer(text: string, isStreaming: boolean, streamStartTime?: number) {
  const fallback = useRef<{ active: boolean; at: number }>({ active: false, at: 0 })
  if (!isStreaming || !text) fallback.current.active = false
  else if (!fallback.current.active) fallback.current = { active: true, at: Date.now() }
  const startedAt = streamStartTime ?? fallback.current.at
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  const hasContent = !!text.trim()
  useEffect(() => {
    if (!isStreaming || !hasContent) return
    const remaining = startedAt + BUFFER_CONFIG.MAX_BUFFER_MS - Date.now()
    if (remaining < 0) return
    const timer = setTimeout(refresh, remaining + 1)
    return () => clearTimeout(timer)
  }, [startedAt, isStreaming, hasContent])
  return shouldShowContent(text, isStreaming, startedAt)
}
