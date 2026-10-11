/** Pure permissions schema and regex validation; no host storage or agent lifecycle. */
import { PermissionsConfigSchema, type PermissionsConfigFile } from './mode-types.ts';
import { safeJsonParse } from '../utils/json.ts';
import { zodErrorToIssues } from '../config/source-validation.ts';
import type { ValidationIssue, ValidationResult } from '../config/schemas.ts';

export function validateRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export function validatePermissionsConfig(config: PermissionsConfigFile): string[] {
  const errors: string[] = [];

  // Validate regex patterns
  const checkPatterns = (patterns: Array<string | { pattern: string }> | undefined, name: string) => {
    if (!patterns) return;
    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];
      if (!p) continue;
      const patternStr = typeof p === 'string' ? p : p.pattern;
      if (!validateRegex(patternStr)) {
        errors.push(`${name}[${i}]: Invalid regex pattern: ${patternStr}`);
      }
    }
  };

  checkPatterns(config.allowedBashPatterns, 'allowedBashPatterns');
  checkPatterns(config.allowedMcpPatterns, 'allowedMcpPatterns');

  // Validate API endpoint patterns
  if (config.allowedApiEndpoints) {
    for (let i = 0; i < config.allowedApiEndpoints.length; i++) {
      const rule = config.allowedApiEndpoints[i];
      if (rule && !validateRegex(rule.path)) {
        errors.push(`allowedApiEndpoints[${i}].path: Invalid regex pattern: ${rule.path}`);
      }
    }
  }

  // Validate blocked command hint conditional regex patterns
  if (config.blockedCommandHints) {
    for (let i = 0; i < config.blockedCommandHints.length; i++) {
      const hint = config.blockedCommandHints[i];
      if (hint?.whenNotMatching && !validateRegex(hint.whenNotMatching)) {
        errors.push(`blockedCommandHints[${i}].whenNotMatching: Invalid regex pattern: ${hint.whenNotMatching}`);
      }
    }
  }

  return errors;
}

export function validatePermissionsContent(jsonString: string, displayFile: string = 'permissions.json'): ValidationResult {
  const errors: ValidationIssue[] = [];

  // Parse JSON
  let content: unknown;
  try {
    content = safeJsonParse(jsonString);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file: displayFile,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Validate schema
  const result = PermissionsConfigSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, displayFile));
    return { valid: false, errors, warnings: [] };
  }

  // Validate regex patterns (semantic validation)
  const regexErrors = validatePermissionsConfig(result.data);
  for (const regexError of regexErrors) {
    errors.push({
      file: displayFile,
      path: regexError.split(':')[0] || '',
      message: regexError,
      severity: 'error',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}
