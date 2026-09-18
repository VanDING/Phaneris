/**
 * Resident plugin context block (design §4.2 / §4.3.1, module D).
 *
 * When a plugin is active for a session, one `<plugin_context>` block rides the
 * **volatile** user-message tail every turn. It carries:
 *
 *  - the plugin's resident instructions (`PROMPT.md`), and
 *  - a **roster** of its skills: `name`, `description`, and the absolute path to
 *    each `SKILL.md`.
 *
 * The roster is the whole point of the design, and it is not an invention: Agent
 * Skills specifies three progressive-disclosure tiers, the first of which is
 * "metadata (~100 tokens) loaded at startup for all skills". Loading the game
 * metadata and letting the model read a body when it needs it *is* that tier
 * (§4.3.2). Nothing is force-read, so activating a bundle of ten skills does not
 * cost ten `SKILL.md` reads.
 *
 * Two properties are load-bearing:
 *
 *  1. **Volatile, never the system prefix.** The fragment changes whenever the
 *     active plugin changes, and the system block is the prompt-cache prefix
 *     (issue #862), so putting it there would invalidate cache reuse.
 *  2. **Escaped.** Since P1-1 allows importing a package from outside, a fragment
 *     is untrusted input: unescaped, a body could close the block early and have
 *     the remainder read as instructions rather than as content.
 */

import { join } from 'node:path';
import type { LoadedPlugin, PluginSkillEntry } from './types.ts';

/** Opening tag of the block, with the plugin name as an attribute (P3-5). */
export const PLUGIN_CONTEXT_TAG = 'plugin_context';

/**
 * Closing-tag scrubber, mirroring `defangBlockTag` in `prompts/system.ts`.
 *
 * Deliberately surgical: only the literal `</plugin_context>` sequence is
 * escaped, so markdown, code fences, and examples in a fragment survive intact.
 * Escaping the body wholesale would corrupt the very code samples a plugin's
 * instructions usually consist of.
 */
export function defangPluginContextTag(content: string): string {
  const re = new RegExp(`<\\s*/\\s*${PLUGIN_CONTEXT_TAG}\\s*>`, 'gi');
  return content.replace(re, `&lt;/${PLUGIN_CONTEXT_TAG}&gt;`);
}

/**
 * Drop characters that could truncate or corrupt injected prompt text.
 *
 * Same set as `stripDangerousControlChars` in `prompts/system.ts`: NUL and other
 * control characters, while keeping tab/newline/CR so multi-line markdown keeps
 * its formatting.
 */
export function stripDangerousControlChars(content: string): string {
  return content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** Sanitize untrusted fragment/roster text before prompt injection. */
export function sanitizePluginPromptText(content: string): string {
  return defangPluginContextTag(stripDangerousControlChars(content));
}

/** One roster line: display name, description, and where to read the body. */
export interface PluginRosterEntry {
  slug: string;
  name: string;
  description: string;
  /** Absolute path to the skill's SKILL.md. */
  skillMdPath: string;
}

/**
 * Build the roster from a plugin's skills.
 *
 * Paths are absolute on purpose: the model is expected to `Read` them directly,
 * and a relative path would make it guess against the working directory.
 */
export function buildPluginRoster(plugin: LoadedPlugin): PluginRosterEntry[] {
  return plugin.resources.skills.map((skill: PluginSkillEntry) => ({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    skillMdPath: join(skill.path, 'SKILL.md'),
  }));
}

/**
 * Render the `<plugin_context>` block for one plugin.
 *
 * @param plugin - The active plugin (D12: at most one per session).
 * @returns the block, or an empty string when the plugin has nothing to say —
 *   no fragment and no skills — so the caller can filter it out.
 */
export function formatPluginContextBlock(plugin: LoadedPlugin): string {
  const roster = buildPluginRoster(plugin);
  const fragment = plugin.promptFragment?.trim();

  if (!fragment && roster.length === 0) return '';

  const parts: string[] = [];

  if (fragment) {
    parts.push(sanitizePluginPromptText(fragment).trim());
  }

  if (roster.length > 0) {
    const lines = roster.map((entry) => {
      const name = sanitizePluginPromptText(entry.name);
      const description = sanitizePluginPromptText(entry.description);
      const path = sanitizePluginPromptText(entry.skillMdPath);
      return `- ${name} (slug: ${entry.slug}): ${description} — read ${path}`;
    });

    parts.push(
      [
        'Available skills (read one only when you need its details; do not read them all up front):',
        ...lines,
      ].join('\n'),
    );
  }

  // The name attribute is what makes the fragment traceable in logs and prompt
  // snapshots, since fragments are not separately visualized (P3-7).
  const name = sanitizePluginPromptText(plugin.name);

  return `<${PLUGIN_CONTEXT_TAG} name="${name}">\n${parts.join('\n\n')}\n</${PLUGIN_CONTEXT_TAG}>`;
}

/**
 * Render the block for the session's active plugin, if any.
 *
 * @returns the block, or undefined when no plugin is active or it renders empty.
 */
export function formatActivePluginContext(
  plugin: LoadedPlugin | null | undefined,
): string | undefined {
  if (!plugin) return undefined;
  const block = formatPluginContextBlock(plugin);
  return block || undefined;
}
