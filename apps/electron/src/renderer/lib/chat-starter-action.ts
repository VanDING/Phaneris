/**
 * Resolve what clicking a chat starter should do.
 *
 * Shared core of the starter chip: the prompt is sent verbatim, its mentions are
 * resolved against what the workspace actually has, and only the sources that are
 * not already enabled are enabled. Unknown mentions resolve to nothing, so a
 * starter that mentions a deleted source stays harmless.
 *
 * Pure and renderer-safe so the behaviour can be exercised without a DOM.
 */

import { parseMentions } from '@phaneris/shared/mentions'

export interface ChatStarterActionInput {
  prompt: string
  /** Source slugs available in this workspace. */
  availableSources: readonly string[]
  /** Skill slugs available in this workspace. */
  availableSkills: readonly string[]
  /** Source slugs already enabled on the session. */
  enabledSources: readonly string[]
}

export interface ChatStarterAction {
  /** Message to send (the starter prompt, unchanged). */
  prompt: string
  /** Sources to enable before sending; empty when nothing new is mentioned. */
  enableSources: string[]
  /** Skills to hand to the send call; empty when none are mentioned. */
  skillSlugs: string[]
}

export function resolveChatStarterAction({
  prompt,
  availableSources,
  availableSkills,
  enabledSources,
}: ChatStarterActionInput): ChatStarterAction {
  const mentions = parseMentions(prompt, [...availableSkills], [...availableSources])
  return {
    prompt,
    enableSources: mentions.sources.filter(slug => !enabledSources.includes(slug)),
    skillSlugs: mentions.skills,
  }
}
