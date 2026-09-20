import { mkdirSync } from 'node:fs';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
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
}): Promise<DefaultResourceLoader> {
  mkdirSync(options.agentDir, { recursive: true });
  const getPrompt = options.getPrompt ?? (() => currentPhanerisPrompt);
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => getPrompt() || undefined,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      {
        name: 'phaneris-system-prompt',
        factory: (pi) => {
          if (options.observeLifecycle) registerNativeLifecycle(pi, options.observeLifecycle);
          pi.on('before_agent_start', () => {
            const prompt = getPrompt();
            return prompt ? { systemPrompt: prompt } : {};
          });
        },
      },
    ],
  });
  await loader.reload();
  return loader;
}
