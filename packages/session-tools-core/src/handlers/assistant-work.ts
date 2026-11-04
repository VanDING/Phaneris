import type { SessionToolContext } from '../context'
import type { AssistantDispatch, AssistantWorkQuery, WorkerOptionsQuery } from '../delegation-contracts'
import { successResponse, errorResponse } from '../response'

export async function handleAssistantWorkerOptions(ctx: SessionToolContext, args: WorkerOptionsQuery) {
  if (!ctx.assistantWorkerOptions) return errorResponse('Worker configuration discovery is unavailable.')
  try { return successResponse(JSON.stringify(await ctx.assistantWorkerOptions(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Configuration discovery failed') }
}

export async function handleAssistantDelegate(ctx: SessionToolContext, args: AssistantDispatch) {
  if (!ctx.assistantDelegate) return errorResponse('Delegation is only available to the resident assistant.')
  try { return successResponse(JSON.stringify(await ctx.assistantDelegate(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Delegation failed') }
}
export async function handleAssistantWork(ctx: SessionToolContext, args: AssistantWorkQuery) {
  if (!ctx.assistantWork) return errorResponse('The assistant work inbox is unavailable.')
  try { return successResponse(JSON.stringify(await ctx.assistantWork(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Work lookup failed') }
}
export async function handleAssistantCancelWork(ctx: SessionToolContext, args: { id: string }) {
  if (!ctx.assistantCancelWork) return errorResponse('Assistant work cancellation is unavailable.')
  try { return successResponse(JSON.stringify(await ctx.assistantCancelWork(args.id))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Cancellation failed') }
}
