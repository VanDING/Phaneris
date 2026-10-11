/** Pure JSON parsing shared by browser and filesystem consumers. */
/**
 * Strip UTF-8 BOM (Byte Order Mark) from a string.
 * BOM (\uFEFF) can appear when files are written by certain editors or tools
 * and causes JSON.parse() to fail with "Unexpected token" errors.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Parse a JSON string, stripping any leading UTF-8 BOM.
 * Use this instead of raw JSON.parse() for any content that may originate from a file.
 */
export function safeJsonParse(text: string): unknown {
  return JSON.parse(stripBom(text));
}
