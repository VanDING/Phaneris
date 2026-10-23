/** Forward incremental content, never the SDK's accumulated partial message. */
export function compactTextUpdate(event: { assistantMessageEvent: { type: string; delta?: string; contentIndex?: number } }, now = Date.now()) {
  const update = event.assistantMessageEvent;
  if (!['text_delta', 'thinking_delta', 'thinking_end'].includes(update.type)) return undefined;
  if (update.type !== 'thinking_end' && !update.delta) return undefined;
  return {
    type: 'message_update' as const,
    assistantMessageEvent: { type: update.type, delta: update.delta ?? '', contentIndex: update.contentIndex ?? 0 },
    ts: now,
  };
}
