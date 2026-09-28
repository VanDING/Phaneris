export * from './types.ts';
export * from './llm-connections.ts';
export * from './llm-validation.ts';
export * from './models.ts';
export * from './models-pi.ts';
export * from './model-fetcher.ts';
// The root every other path derives from. Previously `CONFIG_DIR` reached the
// barrel only through storage.ts's convenience re-export; exporting the resolver
// here (OSS #1062) keeps the single-root contract visible from the barrel.
export { CONFIG_DIR, CONFIG_DIR_ENV_VAR, DATA_DIR_NAME, resolveConfigDir, warnIfLegacyRoot } from './paths.ts';
export * from './preferences.ts';
export * from './storage.ts';
export * from './theme.ts';
export * from './validators.ts';
export * from './cli-domains.ts';
export {
  ConfigWatcher,
  UserThemeWatcher,
  createConfigWatcher,
  type ConfigWatcherCallbacks,
  type UserThemeWatcherCallbacks,
} from './watcher.ts';
