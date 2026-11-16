import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

/** Replace a run-owned directory with a file, preserving its previous contents. */
export function obstructDirectory(directory: string): () => void {
  const retained = existsSync(directory) ? `${directory}.fixture-retained-${randomUUID()}` : undefined
  if (retained) renameSync(directory, retained)
  try { writeFileSync(directory, 'Verification-only directory obstruction') }
  catch (error) { if (retained) renameSync(retained, directory); throw error }
  return () => { unlinkSync(directory); if (retained) renameSync(retained, directory) }
}
