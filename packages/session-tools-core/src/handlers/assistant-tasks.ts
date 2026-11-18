import { errorResponse, successResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'
import type { SessionToolContext } from '../context.ts'
import type { DelegationTaskAmend, DelegationTaskCreate, DelegationTaskControl, DelegationTaskQuery, DelegationTaskVerify } from '../task-delegation-contracts.ts'

/**
 * The five delegation tools. Each states business meaning only; the Host binds
 * the trusted input, computes the version, resolves authority and returns a
 * receipt. Nothing here asks the model to restate a goal verbatim, carry a
 * message hash, or track an execution sequence.
 *
 * A missing callback is an explicit "unavailable", never a silent success.
 */
const unavailable = () => errorResponse('Task delegation is unavailable in this Session')
export async function handleTaskCreate(ctx: SessionToolContext, input: DelegationTaskCreate): Promise<ToolResult> {
  return ctx.delegationCreate ? successResponse(JSON.stringify(await ctx.delegationCreate(input, ctx.toolExecutionId))) : unavailable()
}
export async function handleTaskAmend(ctx: SessionToolContext, input: DelegationTaskAmend): Promise<ToolResult> {
  return ctx.delegationAmend ? successResponse(JSON.stringify(await ctx.delegationAmend(input, ctx.toolExecutionId))) : unavailable()
}
export async function handleTaskQuery(ctx: SessionToolContext, input: DelegationTaskQuery): Promise<ToolResult> {
  return ctx.delegationQuery ? successResponse(JSON.stringify(await ctx.delegationQuery(input))) : unavailable()
}
export async function handleTaskControl(ctx: SessionToolContext, input: DelegationTaskControl): Promise<ToolResult> {
  return ctx.delegationControl ? successResponse(JSON.stringify(await ctx.delegationControl(input))) : unavailable()
}
export async function handleTaskVerify(ctx: SessionToolContext, input: DelegationTaskVerify): Promise<ToolResult> {
  return ctx.delegationVerify ? successResponse(JSON.stringify(await ctx.delegationVerify(input))) : unavailable()
}
