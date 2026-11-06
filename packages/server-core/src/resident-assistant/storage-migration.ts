import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { readAssistantSessionId, readSessionHeader, registerAssistantSessionLocation, validateSessionId } from '@phaneris/shared/sessions'
import { atomicWriteFileSync } from '@phaneris/shared/utils/files'
import { openSqliteDatabase } from '../runtime/sqlite'

interface LayoutManifest {
  version: 1; workspaceId: string; phase: 'prepared' | 'session_moved' | 'memory_published' | 'committed'
  sessionId?: string; sessionFiles: Array<{ path: string; sha256: string; size: number }>; memorySha256?: string; completedAt?: number
}
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const inside = (root: string, path: string) => { const part = relative(root, path); return !part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }

function files(root: string, directory = root): LayoutManifest['sessionFiles'] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (lstatSync(path).isSymbolicLink()) throw new Error('Assistant migration requires ordinary files; a linked entry needs inspection')
    if (entry.isDirectory()) return files(root, path)
    if (!entry.isFile()) throw new Error('Unsupported assistant migration file')
    return [{ path: relative(root, path), size: statSync(path).size, sha256: hash(path) }]
  }).sort((a, b) => a.path.localeCompare(b.path))
}

function legacyAssistant(root: string): string[] {
  const directory = join(root, 'sessions')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .filter(entry => readSessionHeader(join(directory, entry.name, 'session.jsonl'))?.sessionKind === 'resident_assistant').map(entry => entry.name)
}

export function hasAssistantStorage(root: string): boolean {
  return existsSync(join(root, 'assistant')) || existsSync(join(root, 'memory', 'memory.db')) || legacyAssistant(root).length > 0
}

/** Cold, writer-lease protected migration. Never uses a live database file copy. */
export function migrateAssistantStorage(workspace: { id: string; rootPath: string }, afterStep?: (phase: LayoutManifest['phase']) => void): void {
  const root = realpathSync(workspace.rootPath), assistant = join(root, 'assistant'), archive = join(assistant, 'migrations', 'layout-v1')
  mkdirSync(archive, { recursive: true, mode: 0o700 })
  if (!inside(root, realpathSync(archive))) throw new Error('Assistant storage escapes the workspace')
  const manifestPath = join(archive, 'manifest.json'), sourceMemory = join(root, 'memory', 'memory.db'), targetMemory = join(assistant, 'memory', 'memory.db')
  const legacy = legacyAssistant(root), registered = readAssistantSessionId(root)
  if (legacy.length > 1 || legacy.length && registered && legacy[0] !== registered) throw new Error('Conflicting assistant Session identities; migration did not choose one')
  let manifest: LayoutManifest
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LayoutManifest
    if (manifest.version !== 1 || manifest.workspaceId !== workspace.id || !Array.isArray(manifest.sessionFiles)) throw new Error('Assistant migration manifest ownership is invalid')
    if (!['prepared', 'session_moved', 'memory_published', 'committed'].includes(manifest.phase)
      || manifest.memorySha256 !== undefined && !/^[a-f0-9]{64}$/.test(manifest.memorySha256)
      || manifest.sessionFiles.some(entry => !entry.path || isAbsolute(entry.path) || entry.path.split(/[\\/]/).some(part => part === '..' || part === '.')
        || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0)) throw new Error('Invalid assistant migration manifest entries')
    if (manifest.phase === 'committed') {
      if (legacy.length || existsSync(sourceMemory)) throw new Error('Retired assistant storage reappeared; refusing a second writable authority')
      return
    }
  } else {
    // A fresh workspace requires no relocation. New Session creation registers its own identity.
    if (!legacy.length && !existsSync(sourceMemory)) return
    if (existsSync(sourceMemory) && existsSync(targetMemory)) throw new Error('Both memory databases exist without a migration manifest; refusing to merge competing stores')
    const sessionId = legacy[0]
    if (sessionId) validateSessionId(sessionId)
    manifest = { version: 1, workspaceId: workspace.id, phase: 'prepared', sessionId,
      sessionFiles: sessionId ? files(join(root, 'sessions', sessionId)) : [] }
    if (sessionId) for (const entry of manifest.sessionFiles) {
      const destination = join(archive, 'session', entry.path)
      mkdirSync(dirname(destination), { recursive: true }); copyFileSync(join(root, 'sessions', sessionId, entry.path), destination)
      if (hash(destination) !== entry.sha256) throw new Error('Assistant Session backup verification failed')
    }
    atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    afterStep?.('prepared')
  }
  const commit = (phase: LayoutManifest['phase']) => {
    manifest.phase = phase
    if (phase === 'committed') manifest.completedAt = Date.now()
    atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 }); afterStep?.(phase)
  }
  if (manifest.sessionId) {
    validateSessionId(manifest.sessionId)
    const old = join(root, 'sessions', manifest.sessionId), target = join(assistant, 'sessions', manifest.sessionId)
    mkdirSync(dirname(target), { recursive: true })
    if (!inside(root, realpathSync(dirname(target)))) throw new Error('Assistant Session destination escapes the workspace')
    if (existsSync(old) && existsSync(target)) throw new Error('Both assistant Session locations exist; preserve them for inspection')
    if (existsSync(old)) {
      if (!inside(root, realpathSync(old))) throw new Error('Assistant Session source escapes the workspace')
      if (JSON.stringify(files(old)) !== JSON.stringify(manifest.sessionFiles)) throw new Error('Assistant Session changed during migration')
      renameSync(old, target)
    }
    if (JSON.stringify(files(target)) !== JSON.stringify(manifest.sessionFiles)) throw new Error('Relocated assistant Session failed verification')
    if (readSessionHeader(join(target, 'session.jsonl'))?.sessionKind !== 'resident_assistant') throw new Error('Relocated Session lost its assistant identity')
    if (manifest.phase === 'prepared') commit('session_moved')
  }
  if (existsSync(sourceMemory)) {
    if (!inside(root, realpathSync(sourceMemory))) throw new Error('Assistant memory source escapes the workspace')
    const database = openSqliteDatabase(sourceMemory), snapshot = join(archive, 'memory.db')
    try {
      database.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
      const owner = database.prepare('SELECT workspace_id FROM owner WHERE singleton=1').get() as { workspace_id: string } | undefined
      if (owner?.workspace_id !== workspace.id) throw new Error('Legacy assistant memory belongs to another workspace')
      if (!existsSync(snapshot)) database.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`)
      const check = openSqliteDatabase(snapshot)
      try { if ((check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new Error('Assistant memory backup is corrupt') }
      finally { check.close() }
      manifest.memorySha256 ??= hash(snapshot)
      if (hash(snapshot) !== manifest.memorySha256) throw new Error('Assistant memory backup hash changed')
      mkdirSync(dirname(targetMemory), { recursive: true })
      if (!inside(root, realpathSync(dirname(targetMemory)))) throw new Error('Assistant memory destination escapes the workspace')
      if (!existsSync(targetMemory)) copyFileSync(snapshot, targetMemory)
      if (hash(targetMemory) !== manifest.memorySha256) throw new Error('Published memory differs from the verified migration snapshot')
      commit('memory_published')
    } finally { database.close() }
    const retired = join(archive, 'retired-memory'); mkdirSync(retired, { recursive: true, mode: 0o700 })
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(sourceMemory + suffix)) renameSync(sourceMemory + suffix, join(retired, 'memory.db' + suffix))
    if (!readdirSync(dirname(sourceMemory)).length) rmdirSync(dirname(sourceMemory))
  } else if (manifest.memorySha256 && (!existsSync(targetMemory) || hash(targetMemory) !== manifest.memorySha256)) throw new Error('Interrupted migration has no verified memory destination')
  if (manifest.sessionId) registerAssistantSessionLocation(root, manifest.sessionId)
  commit('committed')
}
