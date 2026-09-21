/**
 * Shared helpers for text injected into XML-ish prompt context blocks.
 *
 * These functions are deliberately small and dependency-free so config, prompt,
 * plugin, and agent-core modules can use them without creating heavy import
 * chains. They do not attempt to sanitize user intent; they only keep injected
 * data from breaking prompt block boundaries or forging extra one-line fields.
 *
 * Two duplicates of this logic used to live in `prompts/system.ts` (project
 * blocks) and `plugins/plugin-context.ts` (plugin fragments); both now call
 * these helpers so a new tag or escape rule only has to be written once.
 */

/** Strip C0 controls except tab/newline/CR, preserving multiline markdown. */
export function stripPromptControlChars(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** Strip all C0 controls, including newlines/tabs, for single-line fields. */
export function stripPromptLineControlChars(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Neutralize literal closing tags so injected data cannot terminate the
 * surrounding prompt block early. Matching is case- and whitespace-insensitive.
 */
export function defangPromptClosingTags(value: string, tagNames: readonly string[]): string {
  return tagNames.reduce((acc, tagName) => {
    const pattern = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<\\s*/\\s*${pattern}\\s*>`, 'gi');
    return acc.replace(re, `&lt;/${tagName}&gt;`);
  }, value);
}

/** Sanitize multiline prompt body text while preserving normal markdown shape. */
export function sanitizePromptBody(value: string, tagNames: readonly string[] = []): string {
  return defangPromptClosingTags(stripPromptControlChars(value), tagNames);
}

/** Sanitize a one-line prompt value such as a filename, slug, or path. */
export function sanitizePromptLine(value: string, tagNames: readonly string[] = []): string {
  return defangPromptClosingTags(stripPromptLineControlChars(value), tagNames);
}

/** Escape a value that will be placed inside a quoted XML-ish attribute. */
export function escapePromptXmlAttr(value: string): string {
  return stripPromptLineControlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Redact credentials embedded in URL authority components before prompt use. */
export function redactPromptUrlCredentials(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi, '$1***@');
}
