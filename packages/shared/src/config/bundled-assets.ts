/** bundled-assets ownership. config.json writes belong exclusively to repository.ts. */

import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'fs';

import { join } from 'path';

import { getBundledAssetsDir } from '../utils/paths.ts';

import { CONFIG_DIR } from './paths.ts';
import type { ToolIconConfig } from '../utils/cli-icon-resolver.ts';
import { atomicWriteFileSync, stripBom } from '../utils/files.ts';

const TOOL_ICONS_DIR_NAME = 'tool-icons';

/**
 * Returns the path to the tool-icons directory: ~/.phaneris/tool-icons/
 */
export function getToolIconsDir(): string {
  return join(CONFIG_DIR, TOOL_ICONS_DIR_NAME);
}

/**
 * Ensure tool-icons directory exists and has bundled defaults.
 * Resolves bundled path automatically via getBundledAssetsDir('tool-icons').
 * Copies bundled tool-icons.json and icon files on first run.
 * Copies missing files and migrates the unchanged legacy application mapping.
 */
export function ensureToolIcons(): void {
  const toolIconsDir = getToolIconsDir();

  // Create tool-icons directory if it doesn't exist
  if (!existsSync(toolIconsDir)) {
    mkdirSync(toolIconsDir, { recursive: true });
  }

  // Resolve bundled tool-icons directory via shared asset resolver
  const bundledToolIconsDir = getBundledAssetsDir('tool-icons');
  if (!bundledToolIconsDir) {
    return;
  }

  // Copy each bundled file if it doesn't exist in the target dir
  // This includes tool-icons.json and all icon files (png, ico, svg, jpg)
  try {
    const bundledFiles = readdirSync(bundledToolIconsDir);
    for (const file of bundledFiles) {
      const destPath = join(toolIconsDir, file);
      if (!existsSync(destPath)) {
        const srcPath = join(bundledToolIconsDir, file);
        copyFileSync(srcPath, destPath);
      }
    }
    const configPath = join(toolIconsDir, 'tool-icons.json');
    const original = readFileSync(configPath, 'utf8');
    const config = JSON.parse(stripBom(original)) as ToolIconConfig;
    // Match the shipped default exactly. Custom names, artwork, and command
    // associations remain user-owned; never overwrite the old SVG in place.
    const legacy = config.tools?.find(tool => tool.id === 'craft-agent'
      && (tool.displayName === 'Craft Agent' || tool.displayName === 'Phaneris')
      && tool.icon === 'craft-agent.svg'
      && tool.commands.length === 1 && tool.commands[0] === 'craft-agent');
    const legacyArtworkPath = join(toolIconsDir, 'craft-agent.svg');
    const bundledLegacyPath = join(bundledToolIconsDir, 'craft-agent.svg');
    const normalizeSvg = (value: string) => value.replace(/\r\n/g, '\n').trim();
    const isDefaultArtwork = existsSync(legacyArtworkPath) && existsSync(bundledLegacyPath)
      && normalizeSvg(readFileSync(legacyArtworkPath, 'utf8')) === normalizeSvg(readFileSync(bundledLegacyPath, 'utf8'));
    if (legacy && isDefaultArtwork && !config.tools.some(tool => tool.id === 'phaneris')) {
      const backup = join(toolIconsDir, 'tool-icons.pre-phaneris.json');
      if (!existsSync(backup)) copyFileSync(configPath, backup);
      Object.assign(legacy, { id: 'phaneris', displayName: 'Phaneris', icon: 'phaneris.svg', commands: ['phaneris'] });
      atomicWriteFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  } catch {
    // Ignore errors — tool icons are optional enhancement
  }
}
