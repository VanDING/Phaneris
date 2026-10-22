import { buildAssistantContract } from './assistant-contract.ts';
import { buildCapabilityGuidance } from './capability-guidance.ts';

/** Product facts are captured once by the host, outside pure prompt modules. */
export interface AssistantPromptFacts {
  workspacePath: string;
  backendName: string;
  platform: string;
  browserTools: boolean;
  managedConfiguration: boolean;
  developerFeedback: boolean;
  decideTool: boolean;
  docs: typeof import('../docs/index.ts').DOC_REFS;
  permissionModes: typeof import('../agent/mode-types.ts').PERMISSION_MODE_CONFIG;
}

/** Exact content and provenance; headings inside injected text are never reparsed. */
export interface PromptSection {
  id: string;
  source: string;
  content: string;
}

export interface CompiledSystemPrompt {
  text: string;
  sections: PromptSection[];
}

/** Order is explicit and stable. No heuristic provider overlay or new default activation. */
export function buildAssistantPromptModules(facts: AssistantPromptFacts): PromptSection[] {
  return [...buildAssistantContract(facts), ...buildCapabilityGuidance(facts)];
}
