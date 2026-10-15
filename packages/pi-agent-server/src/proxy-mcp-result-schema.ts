/** MCP result envelopes for host-owned tools; Pi 1.2.0 no longer exports the old codemode helper. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples']);
const SCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'dependentSchemas', 'dependencies', '$defs', 'definitions']);

/** Keep local references relative to the original output schema after nesting it in the envelope. */
function relocateLocalReferences(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(relocateLocalReferences);
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if (key === '$ref' && typeof value === 'string' && (value === '#' || value.startsWith('#/'))) {
      return [key, `#/properties/structuredContent${value.slice(1)}`];
    }
    if (DATA_KEYWORDS.has(key)) return [key, value];
    if (SCHEMA_MAP_KEYWORDS.has(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, relocateLocalReferences(child)]))];
    }
    return [key, relocateLocalReferences(value)];
  }));
}

/** Codemode receives the full MCP result, with arbitrary JSON structured content when no schema exists. */
export function createProxyMcpResultSchema(structuredContentSchema?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      content: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { enum: ['text', 'image', 'audio', 'resource_link', 'resource'] },
            text: { type: 'string' },
            data: { type: 'string' },
            mimeType: { type: 'string' },
          },
          required: ['type'],
          additionalProperties: true,
        },
      },
      structuredContent: structuredContentSchema ? relocateLocalReferences(structuredContentSchema) : {},
      isError: { type: 'boolean' },
    },
    required: ['content'],
    additionalProperties: true,
  };
}
