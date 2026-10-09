/** Whole-result JSONL bridge. The host owns settings, credentials and accounting. */
import { LARGE_RESULT_FILTER_DEADLINE_MS, LARGE_RESULT_MAX_TEXT_CHARS, type LargeResultFilter, type LargeResultExcerpt } from '../../shared/src/utils/large-response.ts';
import type { PiLargeResultFilterRequest, PiLargeResultFilterCancel } from '../../shared/src/agent/backend/pi/protocol.ts';

export function createLargeResultFilterClient(
  send: (message: PiLargeResultFilterRequest | PiLargeResultFilterCancel) => void,
  timeoutMs = LARGE_RESULT_FILTER_DEADLINE_MS + 1_000,
): { filter: LargeResultFilter; handleResponse: (requestId: string, excerpt: LargeResultExcerpt | null) => void; cancelAll: () => void } {
  const pending = new Map<string, { settle: (excerpt: LargeResultExcerpt | null) => void; cancel: () => void }>();
  const nonce = Math.random().toString(36).slice(2, 10);
  let counter = 0;
  const filter: LargeResultFilter = ({ text, context, filePath, budgetChars, signal }) => {
    if (!context.intent?.trim() || text.length > LARGE_RESULT_MAX_TEXT_CHARS || signal?.aborted) return Promise.resolve(null);
    const intent = context.intent.slice(0, 1_000);
    return new Promise(resolve => {
      const requestId = `pi-lrf-${nonce}-${++counter}`;
      let timer: ReturnType<typeof setTimeout>;
      const settle = (excerpt: LargeResultExcerpt | null) => {
        if (!pending.delete(requestId)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        const valid = excerpt && typeof excerpt.text === 'string' && excerpt.text.length <= budgetChars
          && Number.isInteger(excerpt.kept) && Number.isInteger(excerpt.total) && excerpt.kept > 0 && excerpt.total >= excerpt.kept;
        resolve(valid ? excerpt : null);
      };
      const cancel = () => { settle(null); try { send({ type: 'large_result_filter_cancel', requestId }); } catch {} };
      pending.set(requestId, { settle, cancel });
      timer = setTimeout(cancel, timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      try { send({ type: 'large_result_filter_request', requestId, toolName: context.toolName, intent, text, budgetChars, filePath }); }
      catch { settle(null); }
    });
  };
  return { filter, handleResponse: (id, excerpt) => pending.get(id)?.settle(excerpt), cancelAll: () => { for (const entry of [...pending.values()]) entry.cancel(); } };
}
