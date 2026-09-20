import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { getCurrentSystemPrompt, normalizeContext, type Context, type Model, type Tool } from '@earendil-works/pi-ai';
import { prepareRequestDiagnostics } from './request-diagnostics.ts';

const model = { provider: 'openai', id: 'test' } as Model<any>;
const tool: Tool = { name: 'read', description: 'read a file', parameters: Type.Object({ path: Type.String() }) };
// Must match the digest the manifest publishes for the same input.
const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('derives prompt and tools from the transcript instead of listing system messages twice', () => {
  const context = normalizeContext({
    systemPrompt: '你好\n"quoted"',
    messages: [{ role: 'user', content: '🙂 hello', timestamp: 1 }],
    tools: [tool],
  });
  const result = prepareRequestDiagnostics(model, context);

  expect(result.systemPrompt).toBe('你好\n"quoted"');
  expect(getCurrentSystemPrompt(context.messages)).toBe(result.systemPrompt);
  // The leading system message carries the prompt and the tool declarations, so
  // the manifest reports them as `system` + `tools` and lists conversation only.
  expect(result.contextSnapshot.messages).toEqual([
    { role: 'user', hash: hashOf(context.messages[1]), chars: JSON.stringify(context.messages[1]).length },
  ]);
  expect(result.contextSnapshot.system.hash).toBe(hashOf('你好\n"quoted"'));
  expect(result.contextSnapshot.tools).toEqual([
    { name: 'read', description: 'read a file', hash: hashOf(tool.parameters), schemaChars: JSON.stringify(tool.parameters).length },
  ]);
});

test('hash covers prompt, conversation and tool declarations', () => {
  const context: Context = {
    systemPrompt: 'PROMPT',
    messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    tools: [tool],
  };
  const { canonicalRequestHash } = prepareRequestDiagnostics(model, normalizeContext(context));

  expect(prepareRequestDiagnostics(model, normalizeContext(context)).canonicalRequestHash).toBe(canonicalRequestHash);
  for (const variant of [
    { ...context, systemPrompt: 'OTHER' },
    { ...context, messages: [...context.messages, { role: 'user' as const, content: 'next', timestamp: 2 }] },
    { ...context, tools: [{ ...tool, description: 'different' }] },
  ]) {
    expect(prepareRequestDiagnostics(model, normalizeContext(variant)).canonicalRequestHash).not.toBe(canonicalRequestHash);
  }
});
