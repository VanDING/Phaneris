/** Ephemeral, single-use confirmation capabilities. Restart invalidates all plans. */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzePluginInstall, analyzePluginUninstall, installPlugin, uninstallPlugin, PluginInstallError, type PluginInstallPlan, type PluginUninstallPlan } from './install.ts';

export interface PluginInstallConfirmation {
  planId: string;
  expiresAt: number;
  name: string;
  description?: string;
  packageRoot: string;
  targetRoot: string;
  overwrites: PluginInstallPlan['overwrites'];
  creates: PluginInstallPlan['creates'];
  stdioCommands: PluginInstallPlan['stdioCommands'];
  warnings: PluginInstallPlan['warnings'];
  skills: string[];
  sources: string[];
}
export interface PluginUninstallConfirmation extends PluginUninstallPlan { planId: string; expiresAt: number }
type Pending = { workspace: string; state: string; expiresAt: number; cleanup?: string } &
  ({ kind: 'install'; original: string; originalHash: string; snapshotHash: string; plan: PluginInstallPlan } |
   { kind: 'uninstall'; name: string });
const pending = new Map<string, Pending>();
const TTL_MS = 5 * 60_000;

function digest(path: string): string {
  const hash = createHash('sha256');
  const walk = (current: string, relative: string) => {
    if (!existsSync(current)) { hash.update(`missing:${relative}\0`); return; }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) hash.update(JSON.stringify([relative, 'link', readlinkSync(current)]));
    else if (stat.isDirectory()) { hash.update(JSON.stringify([relative, 'directory'])); for (const entry of readdirSync(current).sort()) walk(join(current, entry), `${relative}/${entry}`); }
    else if (stat.isFile()) hash.update(JSON.stringify([relative, 'file', createHash('sha256').update(readFileSync(current)).digest('hex')]));
    else throw new PluginInstallError(`Unsupported resource: ${current}`);
  };
  walk(path, '');
  return hash.digest('hex');
}
function state(workspace: string): string { return ['plugins', 'skills', 'sources'].map(name => digest(join(workspace, name))).join(':'); }
function discard(id: string, item: Pending): void {
  pending.delete(id);
  if (item.cleanup) { try { rmSync(item.cleanup, { recursive: true, force: true }); } catch { /* no formal resource lives here */ } }
}
function remember(item: Pending): string {
  for (const [id, old] of pending) if (old.expiresAt <= Date.now()) discard(id, old);
  while (pending.size >= 64) { const [id, old] = pending.entries().next().value!; discard(id, old); }
  const id = randomUUID(); pending.set(id, item);
  const timer = setTimeout(() => discard(id, item), Math.max(1, item.expiresAt - Date.now()));
  timer.unref();
  return id;
}
function consume<T>(workspace: string, id: string, kind: Pending['kind'], execute: (item: Pending) => T): T {
  const item = pending.get(id);
  if (!item) throw new PluginInstallError('Confirmation plan is unknown or already consumed; analyze again');
  pending.delete(id); // Every attempt consumes the capability, including a failed attempt.
  try {
    if (item.kind !== kind || realpathSync(workspace) !== item.workspace) throw new PluginInstallError('Confirmation plan belongs to a different workspace or operation');
    if (item.expiresAt <= Date.now()) throw new PluginInstallError('Confirmation plan expired; analyze again');
    if (state(item.workspace) !== item.state) throw new PluginInstallError('Workspace resources changed after confirmation; analyze again');
    return execute(item);
  } finally { discard(id, item); }
}

/** The source is copied before approval; both source and private copy are checked again at consumption. */
export function preparePluginInstall(workspaceRoot: string, packageRoot: string, ttlMs = TTL_MS): PluginInstallConfirmation {
  const workspace = realpathSync(workspaceRoot), original = realpathSync(packageRoot);
  analyzePluginInstall(workspace, original); // Path/manifest guards before copying untrusted input.
  const originalHash = digest(original), before = state(workspace);
  const cleanup = mkdtempSync(join(tmpdir(), 'phaneris-plugin-plan-'));
  try {
    const snapshot = join(cleanup, basename(original));
    mkdirSync(cleanup, { recursive: true }); cpSync(original, snapshot, { recursive: true });
    if (digest(original) !== originalHash || digest(snapshot) !== originalHash || state(workspace) !== before) throw new PluginInstallError('Package or workspace changed during analysis; analyze again');
    const plan = analyzePluginInstall(workspace, snapshot), expiresAt = Date.now() + Math.min(TTL_MS, Math.max(0, ttlMs));
    const planId = remember({ kind: 'install', workspace, state: before, expiresAt, cleanup, original, originalHash, snapshotHash: originalHash, plan });
    return { planId, expiresAt, name: plan.plugin.name, description: plan.plugin.manifest.description,
      packageRoot: original, targetRoot: plan.targetRoot, overwrites: plan.overwrites, creates: plan.creates,
      stdioCommands: plan.stdioCommands, warnings: plan.warnings, skills: plan.plugin.resources.skills.map(skill => skill.slug), sources: plan.sources.map(source => source.slug) };
  } catch (error) { rmSync(cleanup, { recursive: true, force: true }); throw error; }
}
export function executePluginInstall(workspace: string, planId: string) {
  return consume(workspace, planId, 'install', item => {
    if (item.kind !== 'install') throw new PluginInstallError('Wrong plan kind');
    if (digest(item.original) !== item.originalHash || digest(item.plan.packageRoot) !== item.snapshotHash) throw new PluginInstallError('Package changed after confirmation; analyze again');
    return installPlugin(workspace, item.plan);
  });
}
export function preparePluginUninstall(workspaceRoot: string, name: string): PluginUninstallConfirmation {
  const workspace = realpathSync(workspaceRoot), plan = analyzePluginUninstall(workspace, name), expiresAt = Date.now() + TTL_MS;
  const planId = remember({ kind: 'uninstall', workspace, state: state(workspace), expiresAt, name });
  return { ...plan, planId, expiresAt };
}
export function executePluginUninstall(workspace: string, planId: string) {
  return consume(workspace, planId, 'uninstall', item => {
    if (item.kind !== 'uninstall') throw new PluginInstallError('Wrong plan kind');
    return uninstallPlugin(workspace, item.name);
  });
}
