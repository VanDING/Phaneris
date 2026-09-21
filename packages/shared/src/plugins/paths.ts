import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';

/** Resource names are single portable directory components, never paths. */
export function isPluginResourceSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,63}$/.test(value)
    && !value.includes('..') && !value.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

/** Check both lexical containment and existing ancestors (including junctions). */
export function assertPluginPath(root: string, target: string): string {
  const base = resolve(root);
  const absolute = resolve(target);
  const rel = relative(base, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`Plugin path is outside its resource directory: ${target}`);
  }
  let current = absolute;
  while (current !== base) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Plugin resource path contains a symbolic link: ${current}`);
    }
    current = dirname(current);
  }
  if (existsSync(base) && lstatSync(base).isSymbolicLink()) throw new Error(`Plugin resource root is a symbolic link: ${base}`);
  if (existsSync(base) && existsSync(absolute)) {
    const actual = relative(realpathSync(base), realpathSync(absolute));
    if (!actual || actual.startsWith('..') || isAbsolute(actual)) throw new Error(`Plugin resource escapes its root: ${target}`);
  }
  return absolute;
}

export function pluginResourcePath(root: string, slug: string): string {
  if (!isPluginResourceSlug(slug)) throw new Error(`Invalid plugin resource name: ${slug}`);
  return assertPluginPath(root, join(root, slug));
}
