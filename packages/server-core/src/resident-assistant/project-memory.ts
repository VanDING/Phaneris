import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appendProjectMemoryEntry, getProjectMemoryPath, loadProjectById } from '@phaneris/shared/projects'
import { readAssistantMemoryPolicy, assertAssistantMemoryLearning } from '@phaneris/shared/workspaces'
import { AssistantPrivatePaths } from '@phaneris/shared/agent/assistant-private-paths'
import { resolveCanonicalPath } from '@phaneris/shared/utils'
import type { MemorySource, MemorySourceResult } from '@phaneris/session-tools-core/memory-contracts'
import type { ProjectMemoryAppendInput, ProjectMemoryAppendResult, ProjectMemoryRead, ProjectMemoryReadResult, ProjectMemorySearch, ProjectMemorySearchResult } from '@phaneris/session-tools-core/project-memory-contracts'
import { ProjectMemoryEntrySchema } from '@phaneris/session-tools-core/project-memory-contracts'
import { lexicalTokens } from './memory-lexical'

export interface ProjectMemoryContext {
  role: 'resident_assistant' | 'worker'; sessionId: string; projectId?: string; sessionLabel: string
  currentUserSource?: MemorySource; delegatedSource?: MemorySource & { contentHash: string }
  allowedSources?: Array<MemorySource & { contentHash: string }>
}
export interface ProjectMemoryRequestReceipt { fingerprint: string; projectId: string; entryId: string }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const same = (left: MemorySource | undefined, right: MemorySource) => left?.sessionId === right.sessionId && left.messageId === right.messageId
const entryPattern = /<!-- phaneris-project-memory (\{[^\n]*\}) -->\r?\n([\s\S]*?)\r?\n<!-- \/phaneris-project-memory -->/g
const normalizeNote = (value: string) => value.replaceAll('\r\n', '\n').trim()

/** Controlled access to the existing Project file; there is no second fact database. */
export class ProjectMemoryService {
  constructor(private readonly workspace: { id: string; rootPath: string }, private readonly memory: {
    readSource(source: MemorySource & { expectedContentHash?: string }): MemorySourceResult
    projectRequest(id: string): ProjectMemoryRequestReceipt | undefined
    recordProjectRequest(id: string, receipt: ProjectMemoryRequestReceipt): void
  }) {}
  private project(projectId: string | undefined, context: ProjectMemoryContext, write = false) {
    const id = projectId ?? context.projectId
    if (!id) throw new Error('Select the target project before accessing its memory')
    if (context.role === 'worker' && id !== context.projectId) throw new Error('A Worker cannot access another project memory scope')
    if (context.allowedSources && id !== context.projectId) throw new Error('Background maintenance cannot widen its project scope')
    const project = loadProjectById(this.workspace.rootPath, id)
    if (!project || !/^[a-z0-9][a-z0-9-]*$/.test(project.config.slug)) throw new Error('Project no longer exists in this workspace')
    if (write && id !== context.projectId && (!context.currentUserSource || context.role !== 'resident_assistant')) throw new Error('Project write scope differs from the current instruction')
    return project
  }
  private snapshot(project: NonNullable<ReturnType<typeof loadProjectById>>) {
    const path = getProjectMemoryPath(this.workspace.rootPath, project.config.slug)
    const expectedRoot = join(resolveCanonicalPath(join(this.workspace.rootPath, 'projects')), project.config.slug)
    const part = relative(expectedRoot, resolveCanonicalPath(path))
    if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error('Project MEMORY.md must remain in its own storage scope')
    new AssistantPrivatePaths(this.workspace.rootPath).assertPublic(path)
    let content = '', sizeBytes = 0
    if (existsSync(path)) {
      const before = statSync(path, { bigint: true })
      if (!before.isFile() || before.nlink > 1n) throw new Error('Project memory must be an independently owned regular file')
      if (before.size > 64n * 1024n * 1024n) throw new Error('Project memory exceeds the 64 MiB read budget; keep large documents in Sources')
      const bytes = readFileSync(path), after = statSync(path, { bigint: true })
      if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytes.length) !== after.size) throw new Error('Project memory changed during reading; retry its current version')
      content = bytes.toString('utf8'); sizeBytes = bytes.length
    }
    return { content, reference: { projectId: project.config.id, path, uri: pathToFileURL(path).href,
      contentHash: digest(content), readAt: Date.now(), sizeBytes } }
  }
  read(input: ProjectMemoryRead, context: ProjectMemoryContext): ProjectMemoryReadResult {
    const snapshot = this.snapshot(this.project(input.projectId, context)), full = snapshot.content
    if (input.expectedContentHash && input.expectedContentHash !== snapshot.reference.contentHash) throw new Error('Project memory content hash changed; read the current version')
    const offset = Math.min(input.offset ?? 0, full.length), end = Math.min(offset + (input.maxChars ?? 0), full.length)
    return { reference: snapshot.reference, content: full.slice(offset, end), range: { offset, end, fullChars: full.length,
      startLine: full.slice(0, offset).split('\n').length, endLine: full.slice(0, end).split('\n').length }, nextOffset: end < full.length ? end : null }
  }
  search(input: ProjectMemorySearch, context: ProjectMemoryContext): ProjectMemorySearchResult {
    const project = this.project(input.projectId, context), snapshot = this.snapshot(project), terms = lexicalTokens(input.query, true)
    const fingerprint = digest(JSON.stringify([project.config.id, input.query, input.limit ?? 5]))
    if (input.cursor && (input.cursor.contentHash !== snapshot.reference.contentHash || input.cursor.fingerprint !== fingerprint)) throw new Error('Project memory version or search changed; restart lookup')
    const chunks: Array<ProjectMemorySearchResult['items'][number] & { score: number }> = []
    let title = project.config.name, offset = 0, lineNumber = 1, start = 0, firstLine = 1, lastLine = 1, end = 0, lines: string[] = [], paragraphs = 0
    const flush = () => {
      if (!lines.length) return
      paragraphs++
      const content = lines.join('\n'), normalized = content.normalize('NFKC').toLocaleLowerCase()
      const score = terms.reduce((total, term) => total + (normalized.includes(term) ? term.length : 0), 0)
      if (score) chunks.push({ title, content: content.slice(0, 1600), truncated: content.length > 1600,
        range: { offset: start, end, startLine: firstLine, endLine: lastLine }, score })
      lines = []
    }
    for (const raw of snapshot.content.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (!line.trim() || /^<!-- \/?phaneris-project-memory/.test(line)) flush()
      else if (/^#{1,6}\s/.test(line)) { flush(); title = line.replace(/^#{1,6}\s+/, '') }
      else { if (!lines.length) { start = offset; firstLine = lineNumber }; lines.push(line); end = offset + line.length; lastLine = lineNumber }
      offset += raw.length + 1; lineNumber++
    }
    flush(); chunks.sort((left, right) => right.score - left.score || left.range.offset - right.range.offset)
    const from = input.cursor?.offset ?? 0, limit = input.limit ?? 5
    return { reference: snapshot.reference, items: chunks.slice(from, from + limit).map(({ score: _score, ...item }) => item),
      nextCursor: from + limit < chunks.length ? { contentHash: snapshot.reference.contentHash, fingerprint, offset: from + limit } : null,
      coverage: { paragraphs, matched: chunks.length } }
  }
  private entries(content: string) {
    return [...content.matchAll(entryPattern)].flatMap(match => {
      let metadata: unknown
      try { metadata = JSON.parse(match[1]!) } catch { return [] }
      const parsed = ProjectMemoryEntrySchema.safeParse(metadata)
      return parsed.success ? [{ metadata: parsed.data, intact: digest(normalizeNote(match[2]!)) === parsed.data.noteHash }] : []
    })
  }
  verifyEntry(reference: { projectId: string; entryId: string }, source: MemorySource & { contentHash: string }): boolean {
    const project = loadProjectById(this.workspace.rootPath, reference.projectId)
    if (!project) return false
    return this.entries(this.snapshot(project).content).some(entry => entry.intact && entry.metadata.id === reference.entryId
      && same(entry.metadata.source, source) && entry.metadata.source.contentHash === source.contentHash)
  }
  append(input: ProjectMemoryAppendInput, context: ProjectMemoryContext): ProjectMemoryAppendResult {
    const project = this.project(input.projectId, context, true), note = normalizeNote(input.note), policy = readAssistantMemoryPolicy(this.workspace)
    if (/<!-- \/?phaneris-project-memory/.test(note)) throw new Error('Project memory metadata markers are reserved')
    const allowed = context.allowedSources?.find(source => same(source, input.evidence.source))
    if (context.allowedSources && !allowed) throw new Error('Project evidence is outside the maintenance source grant')
    if (context.role === 'worker' && input.evidence.source.sessionId !== context.sessionId && !same(context.delegatedSource, input.evidence.source)) throw new Error('A Worker cannot inspect private evidence outside its assignment')
    const source = this.memory.readSource({ ...input.evidence.source, expectedContentHash: allowed?.contentHash
      ?? (same(context.delegatedSource, input.evidence.source) ? context.delegatedSource?.contentHash : undefined) })
    const explicit = input.intent === 'user_request' && same(context.currentUserSource, source) && source.directUser
    if (input.intent === 'user_request' && !explicit) throw new Error('Historical or internal inputs cannot authorize an explicit project memory operation')
    assertAssistantMemoryLearning(policy, explicit ? 'user_request' : 'automatic')
    if (input.assessment.confidence !== 'supported' || input.assessment.durability !== 'durable' || !['project_fact', 'experience'].includes(input.assessment.domain)) throw new Error('Project memory requires a supported durable assessment; sensitive, secret and authority material is ineligible')
    const quote = input.evidence.quote
    if (![quote, JSON.stringify(quote).slice(1, -1), JSON.stringify(JSON.stringify(quote).slice(1, -1)).slice(1, -1)].some(text => source.content.includes(text))) throw new Error('Project memory evidence quote does not match the actual source')
    const observation = !!source.observation && source.role === 'tool' && !/"toolName":"(?:mcp__session__)?(?:assistant_|project_memory_)/.test(source.content)
    if (!source.directUser && !observation) throw new Error('Project memory needs a direct user source or a verified non-memory execution observation')
    const crossProject = project.config.id !== context.projectId
    if (crossProject && (!explicit || ![project.config.id, project.config.name, project.config.slug].some(name => source.content.includes(name)))) throw new Error('An explicit cross-project write needs the named project in the current user request')
    if (!crossProject && source.projectId !== project.config.id && !same(context.delegatedSource, source)) throw new Error('Project evidence belongs to another scope')
    const id = digest(JSON.stringify([this.workspace.id, project.config.id, context.sessionId, input.requestId]))
    const sourceReference = { sessionId: source.sessionId, messageId: source.messageId, contentHash: source.contentHash }
    const fingerprint = digest(JSON.stringify([project.config.id, note, sourceReference, quote, input.assessment.domain]))
    const before = this.snapshot(project), entries = this.entries(before.content)
    const receipt = this.memory.projectRequest(id)
    if (receipt && (receipt.fingerprint !== fingerprint || receipt.projectId !== project.config.id)) throw new Error('Project memory request identity conflict')
    if (receipt && !entries.some(entry => entry.intact && entry.metadata.id === receipt.entryId && entry.metadata.fingerprint === fingerprint)) throw new Error('Project memory request entry changed or is unavailable')
    for (const entry of entries) if (entry.metadata.id === id || entry.metadata.fingerprint === fingerprint) {
      if (entry.metadata.fingerprint !== fingerprint || !entry.intact) throw new Error('Project memory request identity or its stored entry changed; review it before a new request')
      this.memory.recordProjectRequest(id, { fingerprint, projectId: project.config.id, entryId: entry.metadata.id })
      return { path: before.reference.path, heading: entry.metadata.heading, bytesAppended: 0, entryId: entry.metadata.id, contentHash: before.reference.contentHash, replayed: true }
    }
    if (input.expectedContentHash !== before.reference.contentHash) throw new Error('Project memory version hash changed; search its current content before appending')
    const heading = `${new Date().toISOString()} — ${context.sessionLabel.replace(/\s+/g, ' ').trim()}`
    const metadata = { version: 1, id, fingerprint, noteHash: digest(note), source: sourceReference, heading }
    const payload = `<!-- phaneris-project-memory ${JSON.stringify(metadata)} -->\n${note}\n<!-- /phaneris-project-memory -->`
    const result = appendProjectMemoryEntry(this.workspace.rootPath, project.config.slug, heading, payload)
    const after = this.snapshot(project)
    if (!this.entries(after.content).some(entry => entry.intact && entry.metadata.id === id)) throw new Error('Project memory changed during append; the note was not verified')
    this.memory.recordProjectRequest(id, { fingerprint, projectId: project.config.id, entryId: id })
    return { ...result, entryId: id, contentHash: after.reference.contentHash, replayed: false }
  }
}
