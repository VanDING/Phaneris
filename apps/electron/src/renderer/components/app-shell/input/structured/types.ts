import type {
  PermissionRequest,
  CredentialRequest,
  CredentialResponse,
  AskUserRequest,
  AskUserAnswerItem,
} from '../../../../../shared/types'
import type { AdminApprovalRequestData } from './AdminApprovalRequest'

/**
 * Input mode determines which component is rendered in InputContainer
 */
export type InputMode = 'freeform' | 'structured'

/**
 * Types of structured input UIs
 */
export type StructuredInputType = 'permission' | 'credential' | 'admin_approval' | 'question'

/**
 * Union type for structured input data
 */
export type StructuredInputData =
  | { type: 'permission'; data: PermissionRequest }
  | { type: 'credential'; data: CredentialRequest }
  | { type: 'admin_approval'; data: AdminApprovalRequestData }
  | { type: 'question'; data: AskUserRequest }

/**
 * State for structured input
 */
export interface StructuredInputState {
  type: StructuredInputType
  data: PermissionRequest | CredentialRequest | AdminApprovalRequestData | AskUserRequest
}

/**
 * Response from permission request
 */
export interface PermissionResponse {
  type: 'permission'
  allowed: boolean
  alwaysAllow: boolean
}

/**
 * Response from admin approval request
 */
export interface AdminApprovalResponse {
  type: 'admin_approval'
  approved: boolean
  rememberForMinutes?: number
}

/**
 * Response from an ask_user question.
 *
 * `cancelled` marks a dismissal: the user closed the question without
 * answering. It still resolves the agent's waiting tool call (so the turn
 * continues), but the model is told the question went unanswered and must not
 * block on it.
 */
export interface QuestionResponse {
  type: 'question'
  answers: AskUserAnswerItem[]
  cancelled: boolean
}

/**
 * Union type for all structured responses
 */
export type StructuredResponse =
  | PermissionResponse
  | CredentialResponse
  | AdminApprovalResponse
  | QuestionResponse

// Re-export CredentialResponse for convenience
export type { CredentialResponse }
