import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { safeJsonParse } from '../../utils/files.ts';

/** Restrictive rules only; approval and transforms stay in the permission pipeline. */
export const ToolCallRulesSchema = z.object({ version: z.literal(1), rules: z.array(z.object({
  id: z.string().min(1).max(128), tool: z.string().min(1).max(256), reason: z.string().min(1).max(1000),
  when: z.object({ field: z.string().min(1).max(128), equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    startsWith: z.string().max(4096).optional() }).strict().refine(v => v.equals !== undefined || v.startsWith !== undefined).optional(),
}).strict()).max(100) }).strict();

export function evaluateToolCallRules(workspaceRoot: string, toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string; ruleId?: string } {
  const path = join(workspaceRoot, 'tool-call-rules.json');
  if (!existsSync(path)) return { allowed: true };
  try {
    if (statSync(path).size > 64 * 1024) throw new Error('Rule file exceeds 64 KiB');
    const config = ToolCallRulesSchema.parse(safeJsonParse(readFileSync(path, 'utf8')));
    for (const rule of config.rules) {
      if (rule.tool !== toolName && rule.tool !== '*') continue;
      if (rule.when) {
        const value = args[rule.when.field];
        if (rule.when.equals !== undefined && value !== rule.when.equals) continue;
        if (rule.when.startsWith !== undefined && (typeof value !== 'string' || !value.startsWith(rule.when.startsWith))) continue;
      }
      return { allowed: false, reason: rule.reason, ruleId: rule.id };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'tool-call-rules.json is invalid. Repair the rule file before running tools.' };
  }
}
