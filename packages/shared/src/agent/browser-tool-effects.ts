import { splitBatchCommands, tokenizeCommand } from './browser-command-parser.ts';
import { isBrowserToolNameOrAlias } from './browser-tool-names.ts';

export interface BrowserToolEffect {
  kind: 'interaction' | 'external_transfer' | 'clipboard_write' | 'script' | 'invalid';
  command: string;
  description: string;
}

/** External servers cannot acquire the internal browser policy by sharing its suffix. */
export function isSessionBrowserTool(name: string): boolean {
  return isBrowserToolNameOrAlias(name) && (!name.includes('__') || name.startsWith('mcp__session__') || name.startsWith('session__'));
}

const READ_EXPRESSIONS = new Set(['document.title', 'document.URL', 'document.documentURI', 'location.href',
  'document.body.innerText', 'document.body.textContent', 'document.documentElement.outerHTML']);

/** Classify explicit transfers and arbitrary JS; clicks/fills retain the existing task-scope policy. */
export function getBrowserToolEffect(name: string, input: Record<string, unknown>): BrowserToolEffect | null {
  if (!isSessionBrowserTool(name)) return null;
  const bare = name.replace(/^(?:mcp__session__|session__)/, '');
  try {
    const raw = input.command;
    const commands: string[][] = bare !== 'browser_tool'
      ? [[bare.replace(/^browser_/, '').replace(/_/g, '-'), String(input.expression ?? '')]]
      : typeof raw === 'string' ? splitBatchCommands(raw).map(tokenizeCommand)
        : Array.isArray(raw) && raw.every(part => typeof part === 'string') ? [raw] : [];
    let selected: BrowserToolEffect = { kind: 'interaction', command: 'browser_tool', description: 'Browser navigation or interaction' };
    for (const parts of commands) {
      const command = parts[0]?.toLowerCase();
      if (command === 'upload') return { kind: 'external_transfer', command, description: 'Attach local files to a browser page' };
      if (command === 'set-clipboard' || command === 'paste') selected = { kind: 'clipboard_write', command, description: 'Write the system clipboard or paste its new contents' };
      if (command === 'evaluate' && !READ_EXPRESSIONS.has(parts.slice(1).join(' ').trim().replace(/;$/, ''))) {
        selected = { kind: 'script', command, description: 'Execute browser JavaScript with potentially external effects' };
      }
    }
    return selected;
  } catch (error) {
    return { kind: 'invalid', command: 'browser_tool', description: error instanceof Error ? error.message : 'Invalid browser command' };
  }
}

export function browserEffectRequiresApproval(effect: BrowserToolEffect | null): boolean {
  return !!effect && ['external_transfer', 'clipboard_write', 'script'].includes(effect.kind);
}
