import type { TrajectorySourceBlock } from '@phaneris/core/types';

export function extractPiSourceBlocks(message: unknown): TrajectorySourceBlock[] | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const msg = message as { content?: string | Array<Record<string, unknown>> };
    if (!Array.isArray(msg.content) || msg.content.length === 0) return undefined;

    const blocks: TrajectorySourceBlock[] = [];
    for (const [index, block] of msg.content.entries()) {
      const type = typeof block.type === 'string' ? block.type : 'other';
      if (type === 'text') {
        if (typeof block.text === 'string' && block.text.length > 0) {
          blocks.push({ type: 'text', content: block.text });
        }
      } else if (type === 'image') {
        const source = block.source as { type?: string; data?: string; url?: string; mediaType?: string } | undefined;
        blocks.push({
          type: 'image',
          imageSrc: typeof source?.data === 'string'
            ? `data:${source.mediaType ?? 'image/png'};base64,${source.data}`
            : typeof source?.url === 'string' ? source.url : undefined,
          imageAlt: typeof block.alt === 'string' ? block.alt : undefined,
        });
      } else if (type === 'thinking' || type === 'reasoning') {
        const content = block.thinking ?? block.text;
        if (typeof content === 'string' && content.trim()) blocks.push({ type: 'thinking', index, content });
      } else if (type === 'tool_use' || type === 'toolCall') {
        blocks.push({
          type: 'tool-call',
          callId: typeof block.id === 'string' ? block.id : undefined,
          toolName: typeof block.name === 'string' ? block.name : undefined,
          content: JSON.stringify(block.arguments ?? block.input ?? {}),
        });
      } else if (type === 'tool_result') {
        const content = block.content;
        const text = Array.isArray(content)
          ? content
            .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof c.text === 'string')
            .map((c) => c.text as string)
            .join('')
          : undefined;
        blocks.push({
          type: 'tool-result',
          content: text,
          callId: typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
        });
      }
    }
    return blocks.length > 0 ? blocks : undefined;
  }
