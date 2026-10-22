import i18n from 'i18next'
import { coerceInputText } from '@/lib/input-text'

export interface BuildPlanApprovalMessageOptions {
  /** Path is a reference; the accepted message snapshot defines scope. */
  planPath?: string
  planSnapshot?: { id: string; content: string }
  approvalMessageSnapshot?: string
  draftInput?: string
}

export interface PlanApprovalEventDetail extends Pick<BuildPlanApprovalMessageOptions, 'planPath' | 'planSnapshot'> {
  sessionId?: string
  includeDraftInput?: boolean
  source?: string
}

function normalizeDraftInput(input?: string): string {
  return coerceInputText(input).trim()
}

export function buildPlanApprovalMessage(options: BuildPlanApprovalMessageOptions = {}): string {
  const draftInput = normalizeDraftInput(options.draftInput)

  const sections: string[] = [i18n.t('plan.approved')]
  if (options.approvalMessageSnapshot) {
    sections.push(options.approvalMessageSnapshot)
  } else if (options.planSnapshot) {
    sections.push(`Accepted plan message: ${options.planSnapshot.id}\nContent revision: message:${options.planSnapshot.id}\nPlan path: ${options.planPath ?? '(not provided)'}\n\nExact plan shown for approval; execute this scope, not a later file revision:\n\n${options.planSnapshot.content}`)
  } else if (options.planPath) {
    sections.push(`Plan path: ${options.planPath}`)
  }

  if (draftInput.length > 0) {
    sections.push(['---', `**${i18n.t('plan.additionalUserContext')}**`, draftInput].join('\n\n'))
  }

  return sections.join('\n\n')
}
