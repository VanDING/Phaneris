/**
 * Raw Pi SDK context metadata carried on JSONL events and RPC responses.
 *
 * Types only — no runtime imports, so both the subprocess and the host can
 * agree on the wire shape without pulling the SDK into the other's bundler.
 */

/** Current occupancy plus the SDK's own compaction reserve, as reported by `AgentSession`. */
export interface PiContextUsagePayload {
  contextUsage?: { tokens: number | null; contextWindow: number; percent?: number | null };
  compactionSettings?: { enabled: boolean; reserveTokens: number };
}

/** Payload of the `compact_result` RPC response. */
export interface PiCompactResult extends PiContextUsagePayload {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** Fresh local estimate supplied by the SDK, not pre-compaction API usage. */
  estimatedTokensAfter?: number;
}

/**
 * Subprocess → main: should this large tool result be summarized? The decision
 * layer lives in the main process (decision model, toggle `largeResults`).
 */
export interface PiLargeResultGateRequest {
  type: 'large_result_gate_request';
  requestId: string;
  toolName: string;
  intent?: string;
  /** The start of the result; the gate reads less than this. */
  text: string;
  estimatedTokens: number;
}

/** Main → subprocess: `false` = the preview and saved file are enough; `true`/`null` = summarize. */
export interface PiLargeResultGateResponse {
  type: 'large_result_gate_response';
  requestId: string;
  summarize: boolean | null;
}
