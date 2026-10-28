import { createHash } from 'node:crypto';

/** Stable model content accounting; transport encoding and result metadata are not text. */
export function requestContentMetrics(message: { role: string; content?: unknown }) {
  const hash = createHash('sha256');
  let textChars = 0;
  let imageCount = 0;
  const toolCalls: Array<{ id: string; hash: string; textChars: number }> = [];
  // Length-prefix strings so different block boundaries cannot hash identically.
  const append = (value: string) => { hash.update(`${value.length}:`).update(value); };
  const text = (value: string) => { textChars += value.length; append(value); };
  append(message.role);
  const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }]
    : Array.isArray(message.content) ? message.content : [];
  for (const value of blocks) {
    if (!value || typeof value !== 'object') continue;
    const block = value as Record<string, unknown>;
    append(String(block.type));
    if (block.type === 'text' && typeof block.text === 'string') text(block.text);
    else if (block.type === 'thinking' && typeof block.thinking === 'string') text(block.thinking);
    else if (block.type === 'toolCall') {
      const payload = JSON.stringify({ name: block.name, arguments: block.arguments });
      append(payload);
      toolCalls.push({ id: String(block.id ?? ''), hash: createHash('sha256').update(payload).digest('hex'), textChars: payload.length });
    } else if (block.type === 'image') {
      imageCount += 1;
      append(typeof block.mimeType === 'string' ? block.mimeType : '');
      append(typeof block.data === 'string' ? block.data : '');
    } else append(JSON.stringify(block));
  }
  return { hash: hash.digest('hex'), textChars, imageCount, ...(toolCalls.length ? { toolCalls } : {}) };
}
