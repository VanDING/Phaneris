/**
 * @phaneris/shared
 *
 * Shared business logic for Phaneris.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { CraftAgent } from '@phaneris/shared/agent';
 *   import { loadStoredConfig } from '@phaneris/shared/config';
 *   import { getCredentialManager } from '@phaneris/shared/credentials';
 *   import { CraftMcpClient } from '@phaneris/shared/mcp';
 *   import { debug } from '@phaneris/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@phaneris/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@phaneris/shared/workspaces';
 *
 * Available modules:
 *   - agent: CraftAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';

// Export the product identity (generated from phaneris.identity.json). Every
// module that needs a product name, app id, deep-link scheme, directory name or
// environment prefix reads it from here — never from a literal.
export * from './identity.generated.ts';
export * from './identity.ts';
