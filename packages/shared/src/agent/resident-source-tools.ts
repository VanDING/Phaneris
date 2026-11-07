import type { PiProxyToolDefinition } from './backend/pi/protocol.ts';
import { loadSource, isSourceUsable } from '../sources/index.ts';
import { loadSourcePermissionsConfig } from './permissions-config.ts';
import { validateRegex } from './permissions-validation.ts';
import { proxyToolName } from '../mcp/proxy-tool-name.ts';

/** Source effects come from Host configuration, never remote annotations or verbs. */
function sourcePolicy(root: string, tool: PiProxyToolDefinition) {
  const namespace = tool.namespace?.name;
  if (!namespace?.startsWith('mcp__')) return { readOnly: false, httpGet: false };
  const slug = namespace.slice('mcp__'.length);
  const source = loadSource(root, slug);
  if (!source || !isSourceUsable(source)) return { readOnly: false, httpGet: false };
  if (source.config.type === 'api') {
    const operations = loadSourcePermissionsConfig(root, slug)?.allowedApiEndpoints.filter(rule => rule.readOnly === true && rule.method === 'POST'
      && rule.path.startsWith('^') && rule.path.endsWith('$') && !/[\[\]()*+?{}|^$\\]/.test(rule.path.slice(1, -1)))
      .map(rule => ({ method: rule.method, path: rule.path.slice(1, -1) })) ?? [];
    return { readOnly: tool.name === proxyToolName(slug, `api_${slug}`), httpGet: true, operations };
  }
  const policy = loadSourcePermissionsConfig(root, slug);
  const originalName = tool.sourceToolName;
  return { httpGet: false, readOnly: !!originalName && tool.name === proxyToolName(slug, originalName)
    && !!policy?.allowedMcpPatterns.some(pattern => validateRegex(pattern)?.test(originalName)) };
}

export function residentSourceToolDefs(root: string, tools: PiProxyToolDefinition[]): PiProxyToolDefinition[] {
  return tools.map(tool => {
    const policy = sourcePolicy(root, tool);
    if (!policy.httpGet) return { ...tool, readOnly: policy.readOnly };
    const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;
    return { ...tool, readOnly: policy.readOnly, inputSchema: { ...tool.inputSchema,
      properties: { ...properties, method: { type: 'string', enum: policy.operations?.length ? ['GET', 'POST'] : ['GET'], description: 'GET or an exact Host-defined read-only operation. Other effects require a work session.' } },
      ...(policy.operations?.length ? { allOf: [{ anyOf: [
        { properties: { method: { const: 'GET' } } }, ...policy.operations.map(operation => ({ properties: { method: { const: operation.method }, path: { const: operation.path } }, required: ['path'] })),
      ] }] } : {}),
    } };
  });
}

/** Re-read policy at every Host boundary, including already-discovered tools. */
export function residentSourceToolAllowed(root: string, tools: PiProxyToolDefinition[], name: string, args: Record<string, unknown>): boolean {
  const tool = tools.find(tool => tool.name === name);
  if (!tool) return false;
  const policy = sourcePolicy(root, tool);
  return policy.readOnly && (!policy.httpGet || args.method === 'GET'
    || !!policy.operations?.some(operation => args.method === operation.method && args.path === operation.path));
}
