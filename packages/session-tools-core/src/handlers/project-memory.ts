import type { SessionToolContext, ProjectMemoryAppendInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type ProjectMemoryAppendArgs = ProjectMemoryAppendInput;

/**
 * project_memory_append — add a dated note to the session's project MEMORY.md.
 * Append-only by design: sessions that rewrote the file from their start-of-session
 * snapshot dropped notes other sessions had added meanwhile. The file write lives
 * behind ctx.appendProjectMemory (projects storage in @phaneris/shared).
 */
export async function handleProjectMemoryAppend(
  ctx: SessionToolContext,
  args: ProjectMemoryAppendArgs
): Promise<ToolResult> {
  if (!ctx.appendProjectMemory) {
    return errorResponse('project_memory_append is not available in this context.');
  }
  try {
    const result = await ctx.appendProjectMemory(args);
    return successResponse(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to add the note: ${message}`);
  }
}

export async function handleProjectMemoryRead(ctx: SessionToolContext, args: import('../project-memory-contracts').ProjectMemoryRead): Promise<ToolResult> {
  if (!ctx.readProjectMemory) return errorResponse('Project memory reading is unavailable.');
  try { return successResponse(JSON.stringify(await ctx.readProjectMemory(args))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)); }
}

export async function handleProjectMemorySearch(ctx: SessionToolContext, args: import('../project-memory-contracts').ProjectMemorySearch): Promise<ToolResult> {
  if (!ctx.searchProjectMemory) return errorResponse('Project memory search is unavailable.');
  try { return successResponse(JSON.stringify(await ctx.searchProjectMemory(args))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)); }
}
