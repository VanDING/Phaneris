/** Stateful, stream-local snapshot dictionaries. No filesystem or Node dependency. */
const REFS = '__craftSnapshotRefs'
type ObjectValue = Record<string, unknown>
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value)

export class SnapshotReferenceError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotReferenceError' }
}

/** First occurrence stays inline; subsequent records carry content-addressed references. */
export class SnapshotEncoder {
  private values = new Map<string, string>()
  private hashes = new Map<string, string>()
  constructor(private hash: (json: string) => string) {}

  encode(input: object): ObjectValue {
    const record = input as ObjectValue
    if (record[REFS] !== undefined) throw new SnapshotReferenceError('Encode requires expanded snapshot records')
    const result = { ...record }
    const refs: ObjectValue = { version: 1 }
    const intern = (value: unknown, kind: string): boolean => {
      const json = JSON.stringify(value)
      const key = `${kind}:${json}`
      const previous = this.values.get(key)
      const id = previous ?? this.hash(key)
      const collision = this.hashes.get(id)
      if (collision !== undefined && collision !== key) throw new SnapshotReferenceError('Snapshot content hash collision')
      this.hashes.set(id, key)
      this.values.set(key, id)
      refs[kind] = id
      return previous !== undefined
    }
    if (typeof record.promptSnapshot === 'string' && intern(record.promptSnapshot, 'prompt')) delete result.promptSnapshot
    if (object(record.contextSnapshot) && Array.isArray(record.contextSnapshot.tools)) {
      if (intern(record.contextSnapshot.tools, 'tools')) {
        const context = { ...record.contextSnapshot }
        delete context.tools
        result.contextSnapshot = context
      }
    }
    if (Object.keys(refs).length > 1) result[REFS] = refs
    return result
  }
}

/** Restores both compact and legacy records; repeated tools share the same decoded array. */
export class SnapshotDecoder {
  private values = new Map<string, unknown>()
  private canonical = new Map<string, unknown>()

  decode<T extends object>(input: unknown): T {
    if (!object(input)) throw new SnapshotReferenceError('Invalid snapshot record')
    const refs = input[REFS]
    if (refs !== undefined && (!object(refs) || refs.version !== 1)) throw new SnapshotReferenceError('Unsupported snapshot reference version')
    const result = { ...input }
    delete result[REFS]
    const restore = (value: unknown, kind: string): unknown => {
      const id = object(refs) ? refs[kind] : undefined
      if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new SnapshotReferenceError('Invalid snapshot reference')
      if (value !== undefined) {
        const valid = kind === 'prompt' ? typeof value === 'string' : Array.isArray(value)
        if (!valid) throw new SnapshotReferenceError('Invalid inline snapshot')
        const key = `${kind}:${JSON.stringify(value)}`
        const shared = this.canonical.get(key) ?? value
        this.canonical.set(key, shared)
        if (typeof id === 'string') {
          if (this.values.has(id) && this.values.get(id) !== shared) throw new SnapshotReferenceError('Conflicting snapshot definition')
          this.values.set(id, shared)
        }
        return shared
      }
      if (typeof id !== 'string') return undefined
      if (!this.values.has(id)) throw new SnapshotReferenceError(`Missing ${kind} snapshot definition: ${id}`)
      const restored = this.values.get(id)
      if (kind === 'prompt' ? typeof restored !== 'string' : !Array.isArray(restored)) throw new SnapshotReferenceError('Snapshot reference has the wrong type')
      return restored
    }
    const prompt = restore(input.promptSnapshot, 'prompt')
    if (prompt !== undefined) result.promptSnapshot = prompt
    if (object(input.contextSnapshot)) {
      const tools = restore(input.contextSnapshot.tools, 'tools')
      result.contextSnapshot = { ...input.contextSnapshot, ...(tools !== undefined ? { tools } : {}) }
    } else if (object(refs) && refs.tools !== undefined) {
      throw new SnapshotReferenceError('Tool snapshot reference has no context')
    }
    return result as T
  }
}
