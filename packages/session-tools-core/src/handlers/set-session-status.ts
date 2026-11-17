import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface SetSessionStatusArgs {
  sessionId?: string;
  status: string;
}

export async function handleSetSessionStatus(
  ctx: SessionToolContext,
  args: SetSessionStatusArgs
): Promise<ToolResult> {
  if (!ctx.setSessionStatus) {
    return errorResponse('set_session_status is not available in this context.');
  }

  try {
    let status = args.status;

    // Resolve display name → ID, reject unknown statuses
    if (ctx.resolveStatus) {
      const { resolved, available, category } = ctx.resolveStatus(status);
      if (!resolved) {
        return errorResponse(
          `Unknown status: "${status}". Available status IDs: ${available.join(', ')}`
        );
      }
      // This general status tool cannot close work. The user, the Tasks
      // Conductor, and the resident assistant's constrained result-review
      // boundary use the Host status owner with their own authorization checks.
      if (category === 'closed') {
        return errorResponse(
          `Refusing to set the closed status "${resolved}". Closing a task (done/cancelled) is the user's decision — leave it for them to do on the board. If the work is ready for review, set an open status such as "needs-review" instead.`
        );
      }
      status = resolved;
    }

    await ctx.setSessionStatus(args.sessionId, status);
    const target = args.sessionId ? `session ${args.sessionId}` : 'current session';
    return successResponse(`Status set to "${status}" on ${target}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to set status: ${message}`);
  }
}
