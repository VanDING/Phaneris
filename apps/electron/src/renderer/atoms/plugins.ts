/**
 * Plugins Atom
 *
 * Installed plugin bundles for the current workspace.
 *
 * Read by the `/` menu roster (plugin activation) and by the Plugins sidebar
 * section. AppShell populates it and refreshes it on `plugins:changed`; the
 * renderer never derives the roster itself, because a bundle that fails to load
 * must be reported rather than silently disappear — the RPC list returns both
 * `plugins` and `errors` and only the shell sees the whole answer.
 */

import { atom } from 'jotai'
import type { PluginLoadError, PluginSummary } from '../../shared/types'

/**
 * Atom to store the current workspace's installed plugins.
 * An empty array is meaningful: it means "no plugins installed", which is the
 * normal state for most workspaces, not a loading state.
 */
export const pluginsAtom = atom<PluginSummary[]>([])

/**
 * Bundles that are present on disk but could not be loaded. Kept separate so the
 * UI can surface a broken install instead of rendering a plugin that vanished.
 */
export const pluginLoadErrorsAtom = atom<PluginLoadError[]>([])
