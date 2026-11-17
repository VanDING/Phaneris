interface DependencySession { id: string; workspace: { id: string }; dependencySessionIds?: string[]; sessionKind?: string }

/** Validate the graph at its metadata writer; admission later checks current
 * completion facts. Missing/cross-workspace references and cycles are distinct. */
export function assertSessionDependencies(sessionId: string, workspaceId: string, ids: readonly string[], read: (id: string) => DependencySession | undefined): void {
  const states = new Map<string, 'visiting' | 'visited'>()
  const stack = ids.map(id => ({ id, leave: false }))
  while (stack.length) {
    const frame = stack.pop()!
    if (frame.leave) { states.set(frame.id, 'visited'); continue }
    if (frame.id === sessionId || states.get(frame.id) === 'visiting') throw new Error('Session dependencies cannot contain a cycle')
    if (states.get(frame.id) === 'visited') continue
    const session = read(frame.id)
    if (!session || session.workspace.id !== workspaceId || session.sessionKind) throw new Error(`Dependency session ${frame.id} not found as ordinary work in this workspace`)
    states.set(frame.id, 'visiting'); stack.push({ ...frame, leave: true })
    stack.push(...(session.dependencySessionIds ?? []).map(id => ({ id, leave: false })))
  }
}
