import { AsyncLocalStorage } from 'node:async_hooks';
import { isUtf8 } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolResultProvenance } from '@phaneris/shared/agent/tool-result-contract';

interface ReadCapture { path?: string; buffer?: Buffer; image?: boolean }
export const readCapture = new AsyncLocalStorage<ReadCapture>();
/** The evidence hash covers the very bytes consumed by Pi, not a later filesystem read. */
export async function readFileWithEvidence(path: string): Promise<Buffer> {
  const buffer = await readFile(path);
  const capture = readCapture.getStore();
  if (capture) { capture.path = path; capture.buffer = buffer; }
  return buffer;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function persist(sessionPath: string, content: string | Buffer, suffix: string): Promise<string> {
  const directory = join(sessionPath, 'long_responses');
  await mkdir(directory, { recursive: true });
  const digest = hash(content), path = join(directory, `${digest}.${suffix}`);
  try {
    if (hash(await readFile(path)) !== digest) throw new Error('Evidence hash mismatch');
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = await open(temporary, 'wx', 0o600);
  try { await fd.writeFile(content); await fd.sync(); } finally { await fd.close(); }
  await rename(temporary, path);
  return path;
}

/** Deterministic structure and original samples; never a semantic replacement. */
function structuralOverview(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length <= 180 ? value : { characters: value.length, prefix: value.slice(0, 180), truncated: true };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return { type: 'array', length: value.length,
    ...(depth < 3 ? { sampleRange: [0, Math.min(value.length, 2)], samples: value.slice(0, 2).map(item => structuralOverview(item, depth + 1)) } : {}) };
  const entries = Object.entries(value);
  return depth >= 3 ? { type: 'object', keys: entries.map(([key]) => key).slice(0, 20), totalKeys: entries.length }
    : { ...Object.fromEntries(entries.slice(0, 16).map(([key, item]) => [key, structuralOverview(item, depth + 1)])),
      ...(entries.length > 16 ? { undisplayedKeys: entries.length - 16 } : {}) };
}

interface Block { type: string; text?: string }
interface Result { content: Block[]; details?: Record<string, any>; structuredContent?: unknown }

/** One deterministic projection. Full program values and non-text blocks keep their identity. */
export async function prepareToolResultView<T extends Result>(options: {
  result: T; toolName: string; input: Record<string, unknown>; sessionPath: string; budgetChars: number; capture?: ReadCapture; supportsImages?: boolean;
}): Promise<T & { details: Record<string, any> & { phanerisResult: ToolResultProvenance } }> {
  const { result, toolName, input, sessionPath, capture } = options;
  if (result.details?.phanerisResult?.version === 1) return result as T & { details: Record<string, any> & { phanerisResult: ToolResultProvenance } };
  const text = result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
  const reading = /^(?:read|Read)$/.test(toolName);
  const bounded = reading || result.details?.phanerisResult;
  const metadata: ToolResultProvenance = {
    version: 1, source: { scope: 'tool-return' }, coverage: { kind: 'unknown' },
    modelView: { kind: 'exact', sha256: hash(JSON.stringify(result.content)) },
    recovery: { status: 'unavailable', reason: 'No persisted source snapshot' },
  };
  let content = result.content;
  if (reading) {
    metadata.source = { scope: 'source', path: String(capture?.path ?? input.path ?? input.file_path ?? '') };
    const truncated = !!result.details?.truncation?.truncated;
    metadata.coverage.kind = truncated || input.limit !== undefined || Number(input.offset ?? 1) > 1 ? 'partial' : 'unknown';
    metadata.modelView.kind = metadata.coverage.kind === 'partial' ? 'range' : 'exact';
    if (capture?.buffer && isUtf8(capture.buffer) && !capture.image && !result.content.some(b => b.type !== 'text')) {
      const totalLines = capture.buffer.toString('utf8').split('\n').length;
      const startLine = Math.max(1, Number(input.offset) || 1);
      const endLine = Math.min(totalLines, startLine + (result.details?.truncation?.firstLineExceedsLimit ? 0 : truncated
        ? Number(result.details?.truncation?.outputLines ?? 0) : Math.min(Number(input.limit) || totalLines, totalLines - startLine + 1)) - 1);
      metadata.source.sha256 = hash(capture.buffer);
      metadata.source.totalLines = totalLines;
      metadata.coverage = { kind: startLine === 1 && endLine === totalLines ? 'full' : 'partial', startLine, endLine, totalLines };
      if (text.length > Math.max(1000, options.budgetChars)) {
        const lines = capture.buffer.toString('utf8').split('\n');
        const selected: string[] = [];
        let length = 0;
        for (let i = startLine - 1; i < endLine; i++) {
          const line = lines[i]!;
          if (length + line.length + 1 > Math.max(0, options.budgetChars - 1000)) break;
          selected.push(line); length += line.length + 1;
        }
        const end = startLine + selected.length - 1;
        metadata.coverage = { kind: 'partial', startLine, endLine: end, totalLines };
        metadata.modelView.kind = 'range';
        content = [{ type: 'text', text: `${selected.join('\n')}\n\n[Exact source range ${startLine}-${end} of ${totalLines}; budget limited. Read ${metadata.recovery.path ?? metadata.source.path} with offset=${end + 1} and limit to continue.${selected.length ? '' : ' This line requires byte/character range processing with a file tool.'}]` }];
        metadata.modelView.sha256 = hash(JSON.stringify(content));
      }
      if (metadata.coverage.kind === 'full') {
        metadata.recovery = { status: 'inline', reason: 'Delivered content is retained in the canonical tool result; no byte-for-byte source snapshot was created.' };
      } else {
        try { metadata.recovery = { status: 'available', path: await persist(sessionPath, capture.buffer, 'txt') }; }
        catch (error) { metadata.recovery = { status: 'unavailable', reason: String(error) }; }
      }
      if (result.details?.truncation?.firstLineExceedsLimit && metadata.recovery.path) {
        content = [{ type: 'text', text: `[Line ${startLine} exceeds the native read limit. Immutable original: ${metadata.recovery.path}. Use the current platform's shell or a programmatic file tool to inspect a byte/character range. Full-line delivery has not been established.]` }];
        metadata.modelView.sha256 = hash(JSON.stringify(content));
      } else if (metadata.coverage.kind === 'partial' && metadata.recovery.path) {
        content = [...content, { type: 'text', text: `[Immutable source snapshot: ${metadata.recovery.path}; SHA-256 ${metadata.source.sha256}. Use this path for consistent subsequent ranges.]` }];
        metadata.modelView.sha256 = hash(JSON.stringify(content));
      }
    }
  }
  const budget = Math.max(1000, Math.floor(options.budgetChars));
  if (!bounded && text.length > budget) {
    let notice: string;
    try {
      const path = await persist(sessionPath, text, 'txt');
      const canonicalPath = await persist(sessionPath, JSON.stringify(result), 'json');
      metadata.source.sha256 = hash(text);
      metadata.recovery = { status: 'available', path, canonicalPath };
      notice = `[Tool return preview; source completeness unknown. Exact tool-return text saved to: ${path}\nRead/Grep that file by range; canonical blocks: ${canonicalPath}]`;
    } catch (error) {
      metadata.recovery = { status: 'unavailable', reason: String(error) };
      notice = '[Content delivery incomplete: evidence storage failed; this is a preview, not a saved full result. Execution is already complete; do not repeat effects to repair delivery.]';
    }
    const overview = result.structuredContent && typeof result.structuredContent === 'object'
      ? `[Structured tool-return overview; original samples and counts, not complete source coverage]\n${JSON.stringify(structuralOverview(result.structuredContent), null, 2)}` : undefined;
    const texts = Math.max(1, result.content.filter(b => b.type === 'text').length);
    const overviewFits = overview && overview.length <= Math.floor((budget - notice.length) / 2) ? overview : undefined;
    const each = Math.max(0, Math.floor((budget - notice.length - (overviewFits?.length ?? 0)) / texts));
    let overviewPlaced = false;
    content = result.content.map(block => {
      if (block.type !== 'text') return block;
      const value = block.text ?? '';
      const prefix = !overviewPlaced && overviewFits ? overviewFits + '\n' : '';
      overviewPlaced = true;
      if (value.length <= each) return prefix ? { ...block, text: prefix + value } : block;
      const half = Math.max(0, Math.floor((each - 40) / 2));
      return { ...block, text: `${prefix}${value.slice(0, half)}\n[... undisplayed original text ...]\n${half ? value.slice(-half) : ''}` };
    });
    content = [...content, { type: 'text', text: notice }];
    metadata.modelView = { kind: 'preview', sha256: hash(JSON.stringify(content)) };
  }
  if (options.supportsImages === false && content.some(block => block.type === 'image')) {
    content = [...content, { type: 'text', text: '[The current model cannot consume these image blocks. They remain in the canonical result; use an authorized image-capable analysis path to inspect their visual content.]' }];
    metadata.modelView.sha256 = hash(JSON.stringify(content));
  }
  return { ...result, content, details: { ...result.details, phanerisResult: metadata } };
}
