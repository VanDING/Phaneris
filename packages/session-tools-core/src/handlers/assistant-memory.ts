import type { SessionToolContext } from '../context'
import { successResponse, errorResponse } from '../response'
import type { HistoryQuery } from '../history-contracts'
export async function handleAssistantMemoryMaintenance(ctx: SessionToolContext, args: import('../memory-maintenance-contracts').MemoryMaintenanceCommand) {
  if (!ctx.assistantMemoryMaintenance) return errorResponse('Incremental memory maintenance is unavailable in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantMemoryMaintenance(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Memory maintenance failed') }
}
export async function handleAssistantDeliveryAck(ctx: SessionToolContext, args: { eventIds: string[] }) {
  if (!ctx.assistantDeliveryAck) return errorResponse('Resident delivery is not available in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantDeliveryAck(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Delivery acknowledgement failed') }
}

export async function handleAssistantHistorySearch(ctx: SessionToolContext, args: HistoryQuery) {
  if (!ctx.assistantHistorySearch) return errorResponse('Assistant history is not available in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantHistorySearch(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'History lookup failed') }
}

export async function handleAssistantMemorySearch(ctx: SessionToolContext, args: import('../memory-lookup-contracts').MemoryLookupQuery) {
  if (!ctx.assistantMemorySearch) return errorResponse('Assistant memory is not available in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantMemorySearch(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Memory lookup failed') }
}

export async function handleAssistantMemoryInspect(ctx: SessionToolContext, args: import('../memory-lookup-contracts').MemoryInspectQuery) {
  if (!ctx.assistantMemoryInspect) return errorResponse('Assistant memory inspection is unavailable in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantMemoryInspect(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Memory inspection failed') }
}

export async function handleAssistantMemoryRead(ctx: SessionToolContext, args: { sessionId: string; messageId: string; expectedContentHash?: string; offset?: number; maxChars?: number }) {
  if (!ctx.assistantMemoryRead) return errorResponse('Assistant memory is not available in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantMemoryRead(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Memory source reading failed') }
}

export async function handleAssistantMemoryUpdate(ctx: SessionToolContext, args: import('../memory-contracts').MemoryMutation) {
  if (!ctx.assistantMemoryUpdate) return errorResponse('Assistant memory mutation is unavailable in this session.')
  try { return successResponse(JSON.stringify(await ctx.assistantMemoryUpdate(args))) }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Memory mutation failed') }
}
