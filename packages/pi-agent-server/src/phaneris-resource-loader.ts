import { mkdirSync } from 'node:fs';
import { DefaultResourceLoader, createCodemodeExtension, createToolSearchExtension, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerNativeLifecycle, type ObserveLifecycle } from './native-lifecycle-observation.ts';

/**
 * Current Phaneris system prompt for the active session.
 * Updated per prompt message; read by the loader override and the
 * before_agent_start extension hook on every turn and rebuild.
 */
let currentPhanerisPrompt = '';

export function setPhanerisSystemPrompt(prompt: string): void {
  currentPhanerisPrompt = prompt;
}

/**
 * The prompt Pi delivers to the provider for this session: the loader's
 * `systemPromptOverride` and the inline `before_agent_start` hook both read it,
 * and the hook returns it as the forced prompt, so it is the whole system
 * prompt of every request.
 */
export function getPhanerisSystemPrompt(): string {
  return currentPhanerisPrompt;
}

/**
 * Create the SDK resource loader for a Phaneris session.
 *
 * Replaces the private-field stamping in the deleted override module:
 * - `systemPromptOverride` survives `_rebuildSystemPrompt` (tool changes) —
 *   resource-loader.js applies it on every reload/build.
 * - The inline extension's `before_agent_start` hook survives the per-turn
 *   reset: agent-session.js assigns `state.systemPrompt =
 *   _systemPromptOverride ?? _baseSystemPrompt` each turn and clears
 *   `_systemPromptOverride` after each run, so the hook must re-supply it.
 *
 * Phaneris manages context files/skills/prompts/themes itself — disable SDK
 * discovery so nothing foreign leaks into the prompt.
 *
 * `getPrompt` scopes the prompt source to this loader (ephemeral sessions pass
 * a closure over their captured prompt so they can never overwrite or read the
 * main session's module-level prompt); default reads the module-level prompt.
 */
export async function createPhanerisResourceLoader(options: {
  cwd: string;
  agentDir: string;
  /** Prompt source for this loader; defaults to the module-level current Phaneris prompt. */
  getPrompt?: () => string;
  observeLifecycle?: ObserveLifecycle;
  /** Main sessions only. Ephemeral utility queries never get orchestration tools. */
  wrapOrchestrationTool?: (tool: ToolDefinition<any, any>) => ToolDefinition<any, any>;
  gateToolCall?: (toolName: string, input: Record<string, unknown>, toolCallId: string) => Promise<void>;
}): Promise<DefaultResourceLoader> {
  mkdirSync(options.agentDir, { recursive: true });
  const getPrompt = options.getPrompt ?? (() => currentPhanerisPrompt);
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => getPrompt() || undefined,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      ...(options.wrapOrchestrationTool ? [
        { name: 'phaneris-codemode', factory: (pi: Parameters<ReturnType<typeof createCodemodeExtension>>[0]) => {
          createCodemodeExtension({ models: false })({ ...pi, registerTool: tool => pi.registerTool(options.wrapOrchestrationTool!(tool)) });
        } },
        { name: 'phaneris-tool-search', factory: (pi: Parameters<ReturnType<typeof createToolSearchExtension>>[0]) => {
          createToolSearchExtension()({ ...pi, registerTool: tool => pi.registerTool(options.wrapOrchestrationTool!(tool)) });
        } },
      ] : []),
      {
        name: 'phaneris-system-prompt',
        factory: (pi) => {
          if (options.observeLifecycle) registerNativeLifecycle(pi, options.observeLifecycle);
          if (options.gateToolCall) pi.on('tool_call', async event => {
            try { await options.gateToolCall!(event.toolName, event.input, event.toolCallId); }
            catch (error) { return { block: true, reason: error instanceof Error ? error.message : String(error) }; }
          });
          pi.on('before_agent_start', () => {
            const prompt = getPrompt();
            const orchestration = options.wrapOrchestrationTool
              ? '\n\nUse tool_search to discover connected source tools by name, namespace or purpose. Use codemode to batch or filter tool results. Scripts run in a sandbox; every nested call still requires host permission. structuredContent preserves full MCP data. Never replay a script with partially completed effects. The models global is disabled; use the managed host tools for model requests.'
              : '';
            return prompt ? { systemPrompt: prompt + orchestration } : {};
          });
        },
      },
    ],
  });
  await loader.reload();
  return loader;
}
