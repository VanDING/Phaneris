import type { SessionToolContext, UpdateSessionPlanningInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type UpdateSessionPlanningArgs = UpdateSessionPlanningInput;

export async function handleUpdateSessionPlanning(
  ctx: SessionToolContext,
  args: UpdateSessionPlanningArgs,
): Promise<ToolResult> {
  if (!ctx.updateSessionPlanning) {
    return errorResponse('update_session_planning is not available in this context.');
  }

  const { sessionId: _sessionId, ...patch } = args;
  if (!Object.keys(patch).length) {
    return errorResponse('Provide at least one planning field to update.');
  }

  try {
    await ctx.updateSessionPlanning(args);
    const target = args.sessionId ? `session ${args.sessionId}` : 'current session';
    return successResponse(`Planning updated on ${target}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to update planning: ${message}`);
  }
}
