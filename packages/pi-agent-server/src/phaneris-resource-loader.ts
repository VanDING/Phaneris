import { mkdirSync } from 'node:fs';
import { DefaultResourceLoader, createCodemodeExtension, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createPhanerisToolSearch } from './tool-discovery.ts';
import { registerNativeLifecycle, type ObserveLifecycle } from './native-lifecycle-observation.ts';
import { createPhanerisSettingsManager } from './session-settings.ts';
import type { SettingsManager, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { completeToolResultContext } from './canonical-model-context.ts';

/**
 * Current Phaneris system prompt for the active session.
 * Updated per prompt message; read by the loader override and the
 * before_agent_start extension hook on every turn and rebuild.
 */
let currentPhanerisPrompt = '';
let currentTaskInstructions: string[] = [];
export function setPhanerisTaskInstructions(instructions: string | string[]): void { currentTaskInstructions = (Array.isArray(instructions) ? instructions : [instructions]).filter(Boolean); }

export function setPhanerisSystemPrompt(prompt: string): void {
  currentPhanerisPrompt = prompt;
}

/**
 * Resident product prompt. Main requests additionally carry SDK cwd facts and
 * active capability sections; actual request diagnostics replay the transcript.
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
 * - The inline extension re-supplies public prompt options for each run.
 *   Main sessions use structured customPrompt, utility sessions force their
 *   independent captured prompt. No SDK private state is modified.
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
  settingsManager?: SettingsManager;
  /** Prompt source for this loader; defaults to the module-level current Phaneris prompt. */
  getPrompt?: () => string;
  observeLifecycle?: ObserveLifecycle;
  installCompaction?: (pi: ExtensionAPI) => void;
  /** Main sessions only. Ephemeral utility queries never get orchestration tools. */
  wrapOrchestrationTool?: (tool: ToolDefinition<any, any>) => ToolDefinition<any, any>;
  gateToolCall?: (toolName: string, input: Record<string, unknown>, toolCallId: string) => Promise<void>;
  productTools?: () => readonly { name: string; availability?: { status: string; reason?: string }; namespace?: { name: string; instructions?: string } }[];
}): Promise<DefaultResourceLoader> {
  mkdirSync(options.agentDir, { recursive: true });
  const getPrompt = options.getPrompt ?? (() => currentPhanerisPrompt);
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager ?? createPhanerisSettingsManager('ephemeral'),
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
        { name: 'phaneris-tool-search', factory: (pi: ExtensionAPI) => {
          pi.registerTool(options.wrapOrchestrationTool!(createPhanerisToolSearch(pi, name => options.productTools?.().find(t => t.name === name)?.availability)));
        } },
      ] : []),
      {
        name: 'phaneris-system-prompt',
        factory: (pi) => {
          options.installCompaction?.(pi);
          if (options.observeLifecycle) registerNativeLifecycle(pi, options.observeLifecycle);
          pi.on('context_with_system', event => {
            const declared = new Set(getCurrentTools(event.messages).map(t => t.name));
            const sections: Record<string, string | null> = {};
            // Only host-owned definitions contribute privileged product guidance.
            for (const tool of options.productTools?.() ?? []) {
              if (!tool.name.startsWith('mcp__session__') || !tool.namespace?.instructions) continue;
              const key = `phaneris-capability:${tool.namespace.name}`;
              sections[key] ??= null;
              if (declared.has(tool.name)) sections[key] = tool.namespace.instructions;
            }
            const messages = [...event.messages];
            if (Object.keys(sections).length) messages.push({ role: 'system' as const, content: '', sections, timestamp: 0 });
            // Rehydrate the host's explicit selection after native compression,
            // without granting external instructions privileged system scope.
            if (options.wrapOrchestrationTool) for (const instruction of currentTaskInstructions) {
              if (!event.messages.some(message => 'content' in message && JSON.stringify(message.content).includes(JSON.stringify(instruction).slice(1, -1))))
                messages.push({ role: 'user', content: instruction, timestamp: 0 });
            }
            return { messages: options.wrapOrchestrationTool ? completeToolResultContext(messages) : messages };
          });
          if (options.gateToolCall) pi.on('tool_call', async event => {
            try { await options.gateToolCall!(event.toolName, event.input, event.toolCallId); }
            catch (error) { return { block: true, reason: error instanceof Error ? error.message : String(error) }; }
          });
          pi.on('before_agent_start', event => {
            const prompt = getPrompt();
            const orchestration = options.wrapOrchestrationTool
              ? '\n\nUse tool_search to discover connected source tools by name, namespace or purpose. Use codemode to batch or filter tool results. Scripts run in a sandbox; every nested call still requires host permission. structuredContent preserves full MCP data. Never replay a script with partially completed effects. The models global is disabled; use the managed host tools for model requests.'
              : '';
            if (!prompt) return {};
            if (!options.wrapOrchestrationTool) return { systemPrompt: prompt };
            // A forced opaque prompt discards request-time sections in Pi 1.3.
            // Public structured options preserve our custom identity and dynamic
            // capability guidance without inheriting Pi's default coding rules.
            event.systemPromptOptions.forceSystemPrompt = undefined;
            event.systemPromptOptions.customPrompt = prompt + orchestration;
            event.systemPromptOptions.contextFiles = [];
            event.systemPromptOptions.skills = [];
            event.systemPromptOptions.appendSystemPrompt = '';
            return {};
          });
        },
      },
    ],
  });
  await loader.reload();
  return loader;
}
