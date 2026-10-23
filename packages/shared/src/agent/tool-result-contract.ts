/** Host-owned provenance. It describes delivery, never authorization or comprehension. */
export interface ToolResultProvenance {
  version: 1;
  source: { path?: string; sha256?: string; totalLines?: number; scope: 'source' | 'tool-return' };
  coverage: { kind: 'full' | 'partial' | 'unknown'; startLine?: number; endLine?: number; totalLines?: number };
  modelView: { kind: 'exact' | 'range' | 'preview'; sha256: string };
  recovery: { status: 'available' | 'unavailable'; path?: string; canonicalPath?: string; reason?: string };
}

/** Missing metadata is deliberately unknown. Historical summaries are not original evidence. */
export function isDerivedRead(text: string): boolean {
  return /\[(?:Large response[^\]]*summarized|Relevant excerpt:|Response too large|Tool return preview|Content delivery incomplete)/i.test(text);
}
