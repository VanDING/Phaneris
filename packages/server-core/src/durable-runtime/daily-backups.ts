import { existsSync, lstatSync, openSync, closeSync, readSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Legacy VACUUM failures can leave a zero/truncated file at the final name.
 * New snapshots are atomically published only after VACUUM succeeds. */
function isCompletedBackup(path: string): boolean {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size < 100 || existsSync(path + '-journal') || existsSync(path + '-wal')) return false
  const header = Buffer.alloc(100), file = openSync(path, 'r')
  try { readSync(file, header, 0, header.length, 0) } finally { closeSync(file) }
  if (header.toString('ascii', 0, 16) !== 'SQLite format 3\0') return false
  const encodedSize = header.readUInt16BE(16), pageSize = encodedSize === 1 ? 65536 : encodedSize
  return pageSize >= 512 && pageSize <= 65536 && (pageSize & (pageSize - 1)) === 0
    && header.readUInt32BE(28) > 0 && stat.size === header.readUInt32BE(28) * pageSize
}

/** Keep today's completed snapshot and the latest previous one. Never prune
 * recovery points until a new snapshot has been successfully published. */
export async function maintainDailyBackups(workspace: string, createBackup: (destination: string) => Promise<void>): Promise<boolean> {
  const directory = join(workspace, 'runtime', 'backups'), day = new Date().toISOString().slice(0, 10)
  const name = `runtime-${day}.db`, destination = join(directory, name)
  const fresh = !existsSync(destination) || !isCompletedBackup(destination)
  if (fresh) {
    let incomplete: string | undefined
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile()) throw new Error(`Runtime backup path is not a regular file: ${destination}`)
      incomplete = `${destination}.${randomUUID()}.invalid`
      renameSync(destination, incomplete)
    }
    try { await createBackup(destination) }
    catch (error) {
      if (incomplete) renameSync(incomplete, destination)
      throw error
    }
    if (incomplete) unlinkSync(incomplete)
    for (const suffix of ['-journal', '-wal', '-shm']) {
      if (existsSync(destination + suffix)) unlinkSync(destination + suffix)
    }
  }
  if (!isCompletedBackup(destination)) throw new Error(`Runtime backup did not complete: ${destination}`)
  const names = readdirSync(directory)
  const daily = names.filter(file => /^runtime-\d{4}-\d{2}-\d{2}\.db$/.test(file) && file <= name)
  const previous = daily.filter(file => file !== name && isCompletedBackup(join(directory, file))).sort().reverse()[0]
  for (const file of daily) {
    if (file === name || file === previous) continue
    // Refuse unexpected directories/symlinks instead of recursively deleting them.
    if (!lstatSync(join(directory, file)).isFile()) continue
    unlinkSync(join(directory, file))
    for (const suffix of ['-journal', '-wal', '-shm']) {
      if (existsSync(join(directory, file + suffix))) unlinkSync(join(directory, file + suffix))
    }
  }
  for (const file of names) {
    const owned = /^runtime-(\d{4}-\d{2}-\d{2})\.db\.[a-f0-9-]{36}\.(tmp|invalid)$/.exec(file)
    if (owned && owned[1]! < day && lstatSync(join(directory, file)).isFile()) unlinkSync(join(directory, file))
  }
  return fresh
}
