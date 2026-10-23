import { AsyncLocalStorage } from 'node:async_hooks';
import { isUtf8 } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

function persist(sessionPath: string, content: string | Buffer, suffix: string): string {
  const directory = join(sessionPath, 'long_responses');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${hash(content)}.${suffix}`);
  if (existsSync(path)) {
    if (hash(readFileSync(path)) !== hash(content)) throw new Error('Evidence hash mismatch');
    return path;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  return path;
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
      try { metadata.recovery = { status: 'available', path: persist(sessionPath, capture.buffer, 'txt') }; }
      catch (error) { metadata.recovery = { status: 'unavailable', reason: String(error) }; }
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
      } else if (result.details?.truncation?.firstLineExceedsLimit && metadata.recovery.path) {
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
      const path = persist(sessionPath, text, 'txt');
      const canonicalPath = persist(sessionPath, JSON.stringify(result), 'json');
      metadata.source.sha256 = hash(text);
      metadata.recovery = { status: 'available', path, canonicalPath };
      notice = `[Tool return preview; source completeness unknown. Exact tool-return text saved to: ${path}\nRead/Grep that file by range; canonical blocks: ${canonicalPath}]`;
    } catch (error) {
      metadata.recovery = { status: 'unavailable', reason: String(error) };
      notice = '[Content delivery incomplete: evidence storage failed; this is a preview, not a saved full result. Execution is already complete; do not repeat effects to repair delivery.]';
    }
    const texts = Math.max(1, result.content.filter(b => b.type === 'text').length);
    const each = Math.max(0, Math.floor((budget - notice.length) / texts));
    content = result.content.map(block => {
      if (block.type !== 'text') return block;
      const value = block.text ?? '';
      if (value.length <= each) return block;
      const half = Math.max(0, Math.floor((each - 40) / 2));
      return { ...block, text: `${value.slice(0, half)}\n[... undisplayed original text ...]\n${half ? value.slice(-half) : ''}` };
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
