/** Filesystem adapter for the pure permissions contract. */
import { readFileSync } from 'node:fs';
import { validatePermissionsContent } from '../agent/permissions-validation.ts';

export function isValidPermissionsFile(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const result = validatePermissionsContent(content);
    return result.valid;
  } catch {
    return false;
  }
}
