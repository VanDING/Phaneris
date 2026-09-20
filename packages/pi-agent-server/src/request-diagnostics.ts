import { createHash } from 'node:crypto';
import {
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type TranscriptContext,
} from '@earendil-works/pi-ai';

function digest(serialized: string) {
  return { hash: createHash('sha256').update(serialized).digest('hex'), chars: serialized.length };
}

/**
 * Hash the canonical request bytes — provider, model, current prompt, conversation
 * and tool declarations — but serialize each message only once and avoid
 * materializing a second full-context JSON string. The diagnostic manifest shares
 * these serialized message values.
 *
 * Pi SDK 0.86.0 hands providers a normalized transcript: the prompt and tool
 * declarations travel in system messages and are patched by section deltas as
 * instructions and tools change. Replaying them through the SDK helpers keeps the
 * hash and manifest transport-independent and identical to the fields they held
 * when the SDK passed a `Context`.
 */
export function prepareRequestDiagnostics(model: Model<any>, context: TranscriptContext) {
  const systemPrompt = getCurrentSystemPrompt(context.messages);
  const tools = getCurrentTools(context.messages);
  // System messages are represented by `system` and `tools` above; the manifest
  // and hash keep listing conversation messages only.
  const conversation = context.messages.filter(message => message.role !== 'system');
  const hash = createHash('sha256');
  const prefix = JSON.stringify({ provider: model.provider, model: model.id, systemPrompt });
  hash.update(prefix.slice(0, -1)).update(',"messages":[');
  const messages = conversation.map((message, index) => {
    const serialized = JSON.stringify(message) ?? 'null';
    if (index) hash.update(',');
    hash.update(serialized);
    return { role: typeof message.role === 'string' ? message.role : 'unknown', ...digest(serialized) };
  });
  hash.update('],"tools":[');
  tools.forEach((tool, index) => {
    if (index) hash.update(',');
    hash.update(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  });
  hash.update(']');
  hash.update('}');
  return {
    canonicalRequestHash: hash.digest('hex'),
    systemPrompt,
    contextSnapshot: {
      version: 1 as const,
      capturedAt: Date.now(),
      provider: model.provider,
      model: model.id,
      system: digest(JSON.stringify(systemPrompt)),
      messages,
      tools: tools.map(tool => {
        const schema = digest(JSON.stringify(tool.parameters) ?? '');
        return { name: tool.name, ...(tool.description ? { description: tool.description } : {}), hash: schema.hash, schemaChars: schema.chars };
      }),
    },
  };
}
