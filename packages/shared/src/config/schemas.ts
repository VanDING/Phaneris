/** Pure configuration schemas, safe to import in a browser. */
import { z } from 'zod';
import { EntityColorSchema } from '../colors/validate.ts';
import { THINKING_LEVEL_IDS } from '../agent/thinking-levels.ts';
import { SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '../i18n/languages.ts';
import shikiThemeNames from './shiki-themes.generated.json';
// ============================================================
// Validation Result Types
// ============================================================

export interface ValidationIssue {
  file: string;
  path: string;  // JSON path like "workspaces[0].name"
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  fixed?: string[];
}

// ============================================================
// Zod Schemas
// ============================================================

// --- config.json ---

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  createdAt: z.number().int().positive(),
  sessionId: z.string().optional(),
  iconUrl: z.string().optional(),
});

// --- LLM Connection schema for config validation ---

export const LlmProviderTypeSchema = z.enum([
  'anthropic', 'openai', 'openai_compat', 'pi', 'pi_compat', 'copilot',
  // Legacy values kept for config parsing tolerance (migrated at runtime):
  'anthropic_compat', 'bedrock', 'vertex',
]);

export const LlmAuthTypeSchema = z.enum([
  'api_key', 'api_key_with_endpoint', 'oauth', 'iam_credentials',
  'bearer_token', 'service_account_file', 'environment', 'none',
]);

export const CustomEndpointSchema = z.object({
  api: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
  supportsImages: z.boolean().optional(),
});

export const LlmConnectionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  providerType: LlmProviderTypeSchema,
  authType: LlmAuthTypeSchema,
  baseUrl: z.string().optional(),
  models: z.array(z.union([z.string(), z.object({ id: z.string() }).passthrough()])).optional(),
  defaultModel: z.string().optional(),
  modelSelectionMode: z.enum(['automaticallySyncedFromProvider', 'userDefined3Tier']).optional(),
  customEndpoint: CustomEndpointSchema.optional(),
  createdAt: z.number(),
  // Allow additional fields (codexPath, awsRegion, gcpProjectId, etc.)
}).passthrough();

export const StoredConfigSchema = z.object({
  workspaces: z.array(WorkspaceSchema).min(0),
  activeWorkspaceId: z.string().nullable(),
  activeSessionId: z.string().nullable(),
  llmConnections: z.array(LlmConnectionSchema).optional(),
  defaultLlmConnection: z.string().optional(),
  defaultThinkingLevel: z.enum([...THINKING_LEVEL_IDS, 'think'] as [string, ...string[]]).transform(v => v === 'think' ? 'medium' : v).optional(),
  colorTheme: z.string().min(1).optional(),
  themeMode: z.enum(['light', 'dark', 'system']).optional(),
  themeFont: z.enum(['theme', 'inter', 'system']).optional(),
  // Note: tokenDisplay, showCost, cumulativeUsage, defaultPermissionMode removed
  // Permission mode and cyclable modes are now per-workspace in workspace config.json
});

// --- preferences.json ---

export const LocationSchema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
});

export const UserPreferencesSchema = z.object({
  name: z.string().optional(),
  avatar: z.object({
    kind: z.literal('image'),
    dataUrl: z.string().startsWith('data:image/png;base64,').max(1_500_000),
  }).optional(),
  timezone: z.string().optional(),  // TODO: Could validate against IANA timezone list
  location: LocationSchema.optional(),
  notes: z.string().optional(),
  // Internal: mirrors Appearance → Language. Not user-editable.
  // Validated against the registry-derived supported set.
  uiLanguage: z.enum([...SUPPORTED_LANGUAGE_CODES] as [LanguageCode, ...LanguageCode[]]).optional(),
  updatedAt: z.number().int().min(0).optional(),
}).passthrough();

// --- sources/{slug}/config.json ---

export const SourceTypeSchema = z.enum(['mcp', 'api', 'local']);

// MCP source supports two transport types:
// - HTTP/SSE: requires url and authType
// - Stdio: requires command (and optional args, env)
export const McpSourceConfigSchema = z.object({
  transport: z.enum(['http', 'sse', 'stdio']).optional(),
  // HTTP/SSE fields
  url: z.string().url().optional(),
  authType: z.enum(['oauth', 'bearer', 'none']).optional(),
  clientId: z.string().optional(),
  // Stdio fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // Working directory for a spawned stdio server. Only plugin-provided sources
  // set this, and only rooted at ${PLUGIN_ROOT} (design section 5.4.1).
  cwd: z.string().optional(),
  // Custom headers for HTTP/SSE transport (e.g., API keys, custom auth)
  headers: z.record(z.string(), z.string()).optional(),
  // Header names for credential-store auth (values stored in credential store as JSON)
  headerNames: z.array(z.string()).optional(),
}).refine(
  (data) => {
    if (data.transport === 'stdio') {
      // Stdio transport requires command
      return !!data.command;
    } else {
      // HTTP/SSE transport (default) requires url and authType
      return !!data.url && !!data.authType;
    }
  },
  {
    message: 'MCP config requires either (url + authType) for HTTP/SSE or (command) for stdio transport',
  }
);

export const ApiOAuthConfigSchema = z.object({
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  audience: z.string().optional(),
  extraParams: z.record(z.string(), z.string()).optional(),
});

export const ApiSourceConfigSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(['bearer', 'header', 'query', 'basic', 'oauth', 'none']),
  headerName: z.string().optional(),
  headerNames: z.array(z.string()).optional(),
  queryParam: z.string().optional(),
  authScheme: z.string().optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  testEndpoint: z
    .object({
      method: z.enum(['GET', 'POST']),
      path: z.string(),
      body: z.record(z.string(), z.unknown()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  googleService: z.enum(['gmail', 'calendar', 'drive', 'docs', 'sheets', 'youtube', 'searchconsole']).optional(),
  googleScopes: z.array(z.string()).optional(),
  googleOAuthClientId: z.string().optional(),
  googleOAuthClientSecret: z.string().optional(),
  slackService: z.enum(['messaging', 'channels', 'users', 'files', 'full']).optional(),
  slackUserScopes: z.array(z.string()).optional(),
  microsoftService: z.enum(['outlook', 'microsoft-calendar', 'onedrive', 'teams', 'sharepoint']).optional(),
  microsoftScopes: z.array(z.string()).optional(),
  oauth: ApiOAuthConfigSchema.optional(),
});

export const LocalSourceConfigSchema = z.object({
  path: z.string().min(1),
  format: z.string().optional(),
});

// Source brand schema
export const SourceBrandSchema = z.object({
  color: EntityColorSchema.optional(),
});

export const FolderSourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  enabled: z.boolean(),
  provider: z.string().min(1),
  type: SourceTypeSchema,
  mcp: McpSourceConfigSchema.optional(),
  api: ApiSourceConfigSchema.optional(),
  local: LocalSourceConfigSchema.optional(),
  brand: SourceBrandSchema.optional(),
  isAuthenticated: z.boolean().optional(),
  lastTestedAt: z.number().int().min(0).optional(),
  // Workspace-relative plugin root this source was materialized from (design
  // section 5.4.4). Absent for hand-configured sources.
  pluginRoot: z.string().optional(),
  // Timestamps are optional - manually created configs may not have them
  // Storage functions add these automatically when saving
  createdAt: z.number().int().min(0).optional(),
  updatedAt: z.number().int().min(0).optional(),
}).refine(
  (data) => {
    // Ensure correct config block exists for type
    switch (data.type) {
      case 'mcp': return !!data.mcp;
      case 'api': return !!data.api;
      case 'local': return !!data.local;
    }
  },
  { message: 'Config must include type-specific configuration (mcp, api, or local)' }
);

/**
 * Schema for skill metadata (SKILL.md frontmatter)
 */
export const SkillMetadataSchema = z.object({
  name: z.string().min(1, "Add a 'name' field with a human-readable title (e.g., 'Git Commit Helper')"),
  description: z.string().min(1, "Add a 'description' field explaining what this skill does and when to use it (1-2 sentences)"),
  globs: z.array(z.string()).optional(),
  alwaysAllow: z.array(z.string()).optional(),
});

/**
 * Status icons are simple strings: emoji characters, URLs, or local filenames
 * such as "in-progress.svg" which resolve to statuses/icons/in-progress.svg.
 * When icon is omitted, local icon files (statuses/icons/{id}.svg) are still
 * auto-discovered at runtime.
 */
export const StatusIconSchema = z.string();

/**
 * Zod schema for individual status configuration
 */
export const StatusConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Status ID must be lowercase alphanumeric with hyphens'),
  label: z.string().min(1, 'Status label is required'),
  color: EntityColorSchema.optional(),
  icon: StatusIconSchema.optional(),
  category: z.enum(['open', 'closed']),
  isFixed: z.boolean(),
  isDefault: z.boolean(),
  order: z.number().int().min(0),
});

/**
 * Zod schema for workspace status configuration
 */
export const WorkspaceStatusConfigSchema = z.object({
  version: z.number().int().min(1),
  statuses: z.array(StatusConfigSchema),
  defaultStatusId: z.string().min(1),
});

/**
 * Zod schema for individual label configuration.
 * Recursive: each label can have optional children forming a tree.
 * IDs are simple slugs (lowercase alphanumeric + hyphens).
 */
/**
 * Zod schema for auto-label rules. Two kinds share one object schema (a union
 * would collapse every field error into "Invalid input"):
 * - regex rules (`pattern`): non-empty pattern here, regex validity semantically below
 * - semantic rules (`semantic`): a yes/no question for the decision model, threshold in (0, 1]
 * A rule must carry exactly one of `pattern` / `semantic`.
 */
export const AutoLabelRuleSchema = z.object({
  pattern: z.string().min(1, 'Auto-label rule pattern must not be empty').optional(),
  flags: z.string().optional(),
  valueTemplate: z.string().optional(),
  semantic: z.string().min(1, 'Semantic auto-label rule question must not be empty').optional(),
  threshold: z.number().gt(0, 'threshold must be greater than 0').max(1, 'threshold must be at most 1').optional(),
  value: z.string().optional(),
  description: z.string().optional(),
}).superRefine((rule, ctx) => {
  const hasPattern = rule.pattern !== undefined;
  const hasSemantic = rule.semantic !== undefined;
  if (!hasPattern && !hasSemantic) {
    ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Auto-label rule needs a "pattern" (regex) or a "semantic" (yes/no question for the decision model)' });
  } else if (hasPattern && hasSemantic) {
    ctx.addIssue({ code: 'custom', path: ['semantic'], message: 'Auto-label rule must be either a regex rule ("pattern") or a semantic rule ("semantic"), not both' });
  }
  if (hasSemantic && !hasPattern) {
    if (rule.flags !== undefined) ctx.addIssue({ code: 'custom', path: ['flags'], message: 'Semantic rules have no regex flags' });
    if (rule.valueTemplate !== undefined) ctx.addIssue({ code: 'custom', path: ['valueTemplate'], message: 'Semantic rules use "value", not "valueTemplate"' });
  }
  if (hasPattern && !hasSemantic) {
    if (rule.threshold !== undefined) ctx.addIssue({ code: 'custom', path: ['threshold'], message: 'Regex rules have no threshold' });
    if (rule.value !== undefined) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Regex rules use "valueTemplate", not "value"' });
  }
});

export const BaseLabelConfigSchema = z.object({
  id: z.string().regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Label ID must be a simple slug (lowercase alphanumeric + hyphens, e.g., "bug", "frontend")'
  ),
  name: z.string().min(1, 'Label name is required'),
  color: EntityColorSchema.optional(),
  icon: z.string().optional(),
  /** Optional hint: what type of value this label carries (omit for boolean labels) */
  valueType: z.enum(['string', 'number', 'date', 'link']).optional(),
  /** Auto-label rules: regex patterns that scan messages and apply labels automatically */
  autoRules: z.array(AutoLabelRuleSchema).optional(),
});

// Recursive schema: LabelConfig can have children which are also LabelConfigs.
// Zod supports lazy() for recursive types.
export type LabelConfigSchemaType = z.ZodType<{
  id: string;
  name: string;
  color?: unknown;
  icon?: string;
  valueType?: 'string' | 'number' | 'date' | 'link';
  autoRules?: Array<
    | { pattern: string; flags?: string; valueTemplate?: string; description?: string }
    | { semantic: string; threshold?: number; value?: string; description?: string }
  >;
  children?: LabelConfigSchemaType[];
}>;

export const LabelConfigSchema: z.ZodType<any> = BaseLabelConfigSchema.extend({
  children: z.lazy(() => z.array(LabelConfigSchema)).optional(),
});

/**
 * Zod schema for workspace label configuration (recursive tree)
 */
export const WorkspaceLabelConfigSchema = z.object({
  version: z.number().int().min(1),
  labels: z.array(LabelConfigSchema),
});

// ============================================================
// Theme Validators
// ============================================================

export const SafeCSSValueSchema = z.string().trim().min(1).refine(
  (value) => !/[;{}]/.test(value),
  'CSS values cannot contain semicolons or braces'
);

export const CSSColorSchema = SafeCSSValueSchema;
const shikiThemeRegistry = new Set<string>(shikiThemeNames);
const ShikiThemeNameSchema = z.string().refine(value => shikiThemeRegistry.has(value), 'Unknown bundled Shiki theme');

export const ThemeVisualTokenFields = {
  // Core and semantic colors
  background: CSSColorSchema.optional(),
  foreground: CSSColorSchema.optional(),
  accent: CSSColorSchema.optional(),
  info: CSSColorSchema.optional(),
  success: CSSColorSchema.optional(),
  destructive: CSSColorSchema.optional(),
  backgroundElevated: CSSColorSchema.optional(),
  foregroundDimmed: CSSColorSchema.optional(),
  secondary: CSSColorSchema.optional(),
  secondaryForeground: CSSColorSchema.optional(),
  muted: CSSColorSchema.optional(),
  mutedForeground: CSSColorSchema.optional(),
  card: CSSColorSchema.optional(),
  cardForeground: CSSColorSchema.optional(),
  popoverForeground: CSSColorSchema.optional(),
  border: CSSColorSchema.optional(),
  ring: CSSColorSchema.optional(),
  userMessageBubble: CSSColorSchema.optional(),
  // Surfaces
  paper: CSSColorSchema.optional(),
  navigator: CSSColorSchema.optional(),
  input: CSSColorSchema.optional(),
  popover: CSSColorSchema.optional(),
  popoverSolid: CSSColorSchema.optional(),
  // Material / shape / typography / icons / density
  depth: z.enum(['flat', 'elevated', 'neon', 'glass', 'raised']).optional(),
  shadowColor: CSSColorSchema.optional(),
  shadowStrength: z.number().min(0).max(1).optional(),
  glassBlur: SafeCSSValueSchema.optional(),
  radius: SafeCSSValueSchema.optional(),
  borderWidth: SafeCSSValueSchema.optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted', 'double']).optional(),
  fontSans: SafeCSSValueSchema.optional(),
  fontSerif: SafeCSSValueSchema.optional(),
  fontMono: SafeCSSValueSchema.optional(),
  fontSize: SafeCSSValueSchema.optional(),
  letterSpacing: SafeCSSValueSchema.optional(),
  lineHeight: z.union([SafeCSSValueSchema, z.number().positive()]).optional(),
  iconStrokeWidth: z.number().min(0.5).max(4).optional(),
  iconStrokeLinecap: z.enum(['butt', 'round', 'square']).optional(),
  density: z.enum(['compact', 'comfortable', 'cozy']).optional(),
} as const;

export const ThemeDarkOverrideSchema = z.object(ThemeVisualTokenFields).strict();

export const ThemeBackgroundImageSchema = z.string()
  .min(1, 'backgroundImage cannot be empty')
  .max(4096, 'backgroundImage must be a local path or URL, not embedded image data')
  .refine((value) => !value.includes('\0'), {
    message: 'backgroundImage cannot contain null bytes',
  });

export const SupportedThemeModesSchema = z.array(z.enum(['light', 'dark']))
  .min(1, 'supportedModes must include light, dark, or both')
  .max(2)
  .refine((modes) => new Set(modes).size === modes.length, {
    message: 'supportedModes cannot contain duplicates',
  });

/**
 * Zod schema for app-level theme override files (~/.phaneris/theme.json).
 * Allows partial overrides but rejects unknown keys.
 */
export const ThemeOverrideSchema = z.object({
  ...ThemeVisualTokenFields,
  // Scenic mode
  mode: z.enum(['solid', 'scenic']).optional(),
  backgroundImage: ThemeBackgroundImageSchema.optional(),
  // Dark mode overrides
  dark: ThemeDarkOverrideSchema.optional(),
}).strict()
  .refine(
    (data) => {
      const keys = Object.keys(data);
      return keys.length > 0;
    },
    { message: 'Theme override must include at least one supported field' }
  )
  .refine(
    (data) => data.mode !== 'scenic' || Boolean(data.backgroundImage),
    { message: 'backgroundImage is required when mode is scenic', path: ['backgroundImage'] }
  );

/**
 * Zod schema for preset theme files.
 * Validates theme structure and requires at least one color property.
 */
export const PresetThemeSchema = z.object({
  name: z.string().min(1, 'Theme name is required'),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  source: z.string().optional(),
  supportedModes: SupportedThemeModesSchema.optional(),
  ...ThemeVisualTokenFields,
  // Scenic mode
  mode: z.enum(['solid', 'scenic']).optional(),
  backgroundImage: ThemeBackgroundImageSchema.optional(),
  // Dark mode overrides
  dark: ThemeDarkOverrideSchema.optional(),
  // Shiki theme for syntax highlighting
  shikiTheme: z.object({
    light: ShikiThemeNameSchema.optional(),
    dark: ShikiThemeNameSchema.optional(),
  }).strict().optional(),
}).strict().refine(
  (data) => {
    const colorProps = ['background', 'foreground', 'accent', 'info', 'success', 'destructive'];
    return colorProps.some(prop => prop in data);
  },
  { message: 'Theme must have at least one color property (background, foreground, accent, info, success, or destructive)' }
).refine(
  data => data.mode !== 'scenic' || Boolean(data.backgroundImage?.trim()),
  { message: 'backgroundImage is required when mode is scenic', path: ['backgroundImage'] }
);

/**
 * Zod schema for a single tool icon entry in tool-icons.json.
 * Each entry maps CLI commands to an icon file.
 */
export const ToolIconEntrySchema = z.object({
  id: z.string().min(1, 'Tool ID is required').regex(
    /^[a-z0-9-]+$/,
    'ID must be lowercase alphanumeric with hyphens (e.g., "my-tool")'
  ),
  displayName: z.string().min(1, 'Display name is required'),
  icon: z.string().min(1, 'Icon filename is required'),
  commands: z.array(z.string().min(1)).min(1, 'At least one command is required'),
});

/**
 * Zod schema for the full tool-icons.json config.
 * Contains a version number and array of tool icon mappings.
 */
export const ToolIconsConfigSchema = z.object({
  version: z.number().int().min(1, 'Version must be a positive integer'),
  tools: z.array(ToolIconEntrySchema),
});
