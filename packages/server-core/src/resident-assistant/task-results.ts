import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getArtifact, registerCurrentArtifact } from '@phaneris/shared/artifacts'
import { getSessionPath } from '@phaneris/shared/sessions'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import { AssistantPrivatePaths } from '@phaneris/shared/agent/assistant-private-paths'
import type { ReportTaskResult, TaskOutputManifest, TaskOutputReference, TaskDeliverable, TaskDeliverableSelection } from '@phaneris/session-tools-core/task-result-contracts'
import type { AssistantDelegationReceipt, AssistantWorkQuery } from '@phaneris/session-tools-core/delegation-contracts'
import type { SqliteDatabase } from '../runtime/sqlite'

/** References and review facts only; Artifact storage remains the file/version owner. */
export class TaskResultStore {
  constructor(private db: SqliteDatabase, private workspace: { id: string; rootPath: string }) {
    db.exec(`CREATE TABLE IF NOT EXISTS task_results(delegation_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL,
      review_event_id TEXT,selected TEXT,reviewed_at INTEGER);
      CREATE TABLE IF NOT EXISTS task_result_revisions(delegation_id TEXT NOT NULL,revision INTEGER NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,
      PRIMARY KEY(delegation_id,revision),UNIQUE(delegation_id,request_id));`)
    db.exec(`CREATE TABLE IF NOT EXISTS task_output_visibility(delegation_id TEXT NOT NULL,output_key TEXT NOT NULL,artifact_revision TEXT NOT NULL,hidden INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(delegation_id,output_key,artifact_revision));`)
  }
  get(delegationId: string): TaskOutputManifest | undefined {
    const row = this.db.prepare('SELECT body,selected FROM task_results WHERE delegation_id=?').get(delegationId) as { body: string; selected: string | null } | undefined
    if (!row) return
    const manifest = JSON.parse(row.body) as TaskOutputManifest
    const hidden = this.db.prepare('SELECT output_key,artifact_revision FROM task_output_visibility WHERE delegation_id=? AND hidden=1').all(delegationId) as Array<{ output_key: string; artifact_revision: string }>
    return { ...manifest, outputs: manifest.outputs.map(output => ({ ...output, hidden: hidden.some(item => item.output_key === output.key && item.artifact_revision === output.revision) })),
      ...(row.selected ? { selectedKeys: JSON.parse(row.selected) } : {}) }
  }
  setVisibility(command: import('@phaneris/session-tools-core/task-result-contracts').TaskOutputVisibility): TaskOutputManifest {
    return this.db.transaction(() => {
      const manifest = this.get(command.delegationId)
      if (!manifest || manifest.revision !== command.expectedRevision) throw new Error('Output manifest revision changed; refresh task details')
      const output = manifest.outputs.find(output => output.key === command.key)
      if (!output || output.role === 'intermediate' || !manifest.selectedKeys?.includes(command.key)) throw new Error('Only reviewed deliverables can change visibility; process material cannot be promoted')
      this.db.prepare('INSERT INTO task_output_visibility VALUES(?,?,?,?,?) ON CONFLICT(delegation_id,output_key,artifact_revision) DO UPDATE SET hidden=excluded.hidden,updated_at=excluded.updated_at')
        .run(command.delegationId, command.key, output.revision, Number(!command.visible), Date.now())
      return this.get(command.delegationId)!
    })()
  }
  declare(receipt: AssistantDelegationReceipt, authority: {
    inputMessageId: string; sessionId: string; runOperationId: string; workingDirectory: string; ownerSessionId: string
  }, command: ReportTaskResult): TaskOutputManifest {
    if (!['submitting', 'submitted'].includes(receipt.state) || receipt.inputMessageId !== authority.inputMessageId || receipt.sessionId !== authority.ownerSessionId)
      throw new Error('Only the currently executing delegated input can declare task outputs')
    const fingerprint = createHash('sha256').update(canonicalJson(command)).digest('hex')
    const prior = this.db.prepare('SELECT fingerprint,body FROM task_result_revisions WHERE delegation_id=? AND request_id=?').get(receipt.id, command.requestId) as { fingerprint: string; body: string } | undefined
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('Task result request identity conflict'); return JSON.parse(prior.body) }
    const existing = this.get(receipt.id)
    if (existing && command.expectedRevision !== existing.revision) throw new Error('Task result revision changed; inspect the latest manifest')
    const sessionRoot = getSessionPath(this.workspace.rootPath, authority.sessionId)
    const contentRoot = authority.workingDirectory === 'none' ? sessionRoot : authority.workingDirectory
    const privatePaths = new AssistantPrivatePaths(this.workspace.rootPath)
    const outputs = command.outputs.map(output => {
      let resolved
      if (output.path) {
        const path = resolve(contentRoot, output.path)
        if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Declared output file is unavailable')
        const canonical = realpathSync(path)
        privatePaths.assertPublic(canonical)
        resolved = registerCurrentArtifact({ workspaceRootPath: this.workspace.rootPath, workspaceId: this.workspace.id,
          contentRootPath: contentRoot, allowedRoots: [sessionRoot, contentRoot] }, { sessionId: authority.sessionId, sourcePath: canonical, title: output.title })
      } else resolved = getArtifact({ workspaceRootPath: this.workspace.rootPath }, output.artifactId!)
      const artifact = resolved.artifact
      privatePaths.assertPublic(artifact.sourcePath)
      if (![authority.sessionId, authority.ownerSessionId].includes(artifact.sessionId)) throw new Error('Output Artifact is owned by another Session')
      if (['discarded', 'conflict'].includes(artifact.status) || output.role !== 'intermediate' && artifact.status === 'draft') throw new Error('Finish the Artifact before declaring it as a result')
      const revision = artifact.draftRevision ?? artifact.currentRevision
      if (!revision || output.expectedRevision && output.expectedRevision !== revision) throw new Error('Declared Artifact revision changed')
      const version = artifact.revisions.find(item => item.id === revision)!
      return { id: createHash('sha256').update(canonicalJson([receipt.id, output.key])).digest('hex'), key: output.key, role: output.role, parentKey: output.parentKey, artifactId: artifact.id, revision,
        title: output.title ?? artifact.title, sourcePath: artifact.sourcePath, mimeType: artifact.mimeType, size: version.size } satisfies TaskOutputReference
    })
    if (new Set(outputs.map(output => output.artifactId)).size !== outputs.length) throw new Error('The same Artifact cannot have multiple output roles in one manifest')
    const manifest: TaskOutputManifest = { revision: (existing?.revision ?? 0) + 1, summary: command.summary, outputs,
      inputMessageId: authority.inputMessageId, producerSessionId: authority.sessionId, runOperationId: authority.runOperationId }
    this.db.transaction(() => {
      const current = this.get(receipt.id)
      if (current?.revision !== existing?.revision) throw new Error('Concurrent task result revision changed')
      this.db.prepare('INSERT INTO task_result_revisions VALUES(?,?,?,?,?)').run(receipt.id, manifest.revision, command.requestId, fingerprint, JSON.stringify(manifest))
      this.db.prepare('INSERT INTO task_results VALUES(?,?,?,NULL,NULL,NULL) ON CONFLICT(delegation_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,review_event_id=NULL,selected=NULL,reviewed_at=NULL')
        .run(receipt.id, manifest.revision, JSON.stringify(manifest))
    })()
    return manifest
  }
  seal(receipt: AssistantDelegationReceipt, result: { sessionId: string; messageId: string }): void {
    const manifest = this.get(receipt.id)
    if (!manifest || manifest.inputMessageId !== receipt.inputMessageId) return
    this.db.prepare('UPDATE task_results SET body=? WHERE delegation_id=?').run(JSON.stringify({ ...manifest, result }), receipt.id)
  }
  validateSelection(selection: TaskDeliverableSelection): TaskOutputManifest | undefined {
    const manifest = this.get(selection.delegationId)
    // An explicit empty selection publishes no files, including legacy or
    // text-only results whose Worker never declared a manifest.
    if (!manifest && !selection.keys.length) return
    if (!manifest?.result || manifest.revision !== selection.expectedRevision) throw new Error('Read the completed task result and current output manifest before selecting deliverables')
    if (new Set(selection.keys).size !== selection.keys.length) throw new Error('Duplicate deliverable selection')
    for (const key of selection.keys) {
      const output = manifest.outputs.find(output => output.key === key)
      if (!output || output.role === 'intermediate') throw new Error('Process material is not a final deliverable')
      if (output.parentKey && !selection.keys.includes(output.parentKey)) throw new Error('Supporting material requires its selected primary result')
      const { artifact } = getArtifact({ workspaceRootPath: this.workspace.rootPath }, output.artifactId)
      if ((artifact.draftRevision ?? artifact.currentRevision) !== output.revision || ['draft', 'discarded', 'conflict'].includes(artifact.status)) throw new Error('Output revision changed after declaration')
    }
    return manifest
  }
  /** Called inside the same transaction as processing acknowledgement. */
  review(selection: TaskDeliverableSelection, eventId: string): void {
    if (!this.validateSelection(selection)) return
    this.db.prepare('UPDATE task_results SET review_event_id=?,selected=?,reviewed_at=? WHERE delegation_id=?')
      .run(eventId, JSON.stringify(selection.keys), Date.now(), selection.delegationId)
  }
  list(query: AssistantWorkQuery): { deliverables: TaskDeliverable[]; total: number; nextCursor: { createdAt: number; id: string } | null } {
    const where = ["c.phase='delivered'", "json_extract(o.value,'$.role')='final'", "EXISTS(SELECT 1 FROM json_each(r.selected) s WHERE s.value=json_extract(o.value,'$.key'))",
      "NOT EXISTS(SELECT 1 FROM task_output_visibility v WHERE v.delegation_id=r.delegation_id AND v.output_key=json_extract(o.value,'$.key') AND v.artifact_revision=json_extract(o.value,'$.revision') AND v.hidden=1)"]
    const args: unknown[] = []
    const from = `FROM task_results r JOIN work w ON w.id=r.delegation_id LEFT JOIN work_index i ON i.id=w.id
      JOIN inbox_consumption c ON c.event_id=r.review_event_id JOIN json_each(r.body,'$.outputs') o`
    if (query.search) { where.push("(json_extract(o.value,'$.title') LIKE ? ESCAPE '\\' OR i.title LIKE ? ESCAPE '\\')"); const term = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`; args.push(term, term) }
    const total = (this.db.prepare(`SELECT count(*) AS count ${from} WHERE ${where.join(' AND ')}`).get(...args) as { count: number }).count
    const identity = "json_extract(o.value,'$.id')"
    if (query.cursor) { where.push(`(r.reviewed_at<? OR (r.reviewed_at=? AND ${identity}<?))`); args.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id) }
    const limit = query.limit ?? 20
    const rows = this.db.prepare(`SELECT r.delegation_id,r.body,r.selected,r.reviewed_at,COALESCE(i.title,w.request_id) AS task_title,o.value AS output,${identity} AS output_id
      ${from} WHERE ${where.join(' AND ')} ORDER BY r.reviewed_at DESC,${identity} DESC LIMIT ?`).all(...args, limit + 1) as Array<{
        delegation_id: string; body: string; selected: string; reviewed_at: number; task_title: string; output: string; output_id: string
      }>
    const deliverables = rows.slice(0, limit).map(row => {
      const manifest = this.get(row.delegation_id)!, output = JSON.parse(row.output) as TaskOutputReference, selected = JSON.parse(row.selected) as string[]
      return { ...output, manifestRevision: manifest.revision, id: row.output_id, delegationId: row.delegation_id, taskTitle: row.task_title, createdAt: row.reviewed_at, result: manifest.result!,
        supporting: manifest.outputs.filter(item => item.parentKey === output.key && selected.includes(item.key) && !item.hidden) }
    })
    return { deliverables, total, nextCursor: rows.length > limit ? { createdAt: deliverables.at(-1)!.createdAt, id: deliverables.at(-1)!.id } : null }
  }
}
