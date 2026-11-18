/** Shared role contract. Tool publication and Host gates consume this same set. */
export const RESIDENT_TOOL_NAMES = [
  'ask_user', 'get_session_info', 'list_sessions',
  'assistant_context', 'assistant_context_history', 'assistant_memory_maintenance', 'assistant_memory_update', 'assistant_memory_search', 'assistant_memory_inspect', 'assistant_memory_read', 'assistant_history_search',
  'assistant_scenario_capture', 'assistant_scenario_search',
  'project_memory_read', 'project_memory_search', 'project_memory_append',
  'assistant_delegate', 'assistant_work', 'assistant_cancel_work', 'assistant_worker_options', 'assistant_worker_control', 'assistant_delivery_ack',
  'task_create', 'task_amend', 'task_query', 'task_control', 'task_verify',
  'tool_search', 'report_progress', 'read', 'grep', 'find', 'ls',
  'source_list_resources', 'source_read_resource', 'source_list_prompts', 'source_get_prompt', 'source_activate',
] as const

export interface AssistantCapabilityView {
  workerScheduling?: { capacity: number; occupied: number; queued: number; paused: number }
  role: 'resident_assistant'
  workspaceId: string
  revision: string
  tools: string[]
  history: { scope: 'workspace'; originals: true; toolsAndErrors: true; unmemorized: true; permissionSource: 'host' }
  businessExecution: 'worker'
  workerPermissionCeiling: 'safe' | 'ask' | 'guarded' | 'allow-all'
}
