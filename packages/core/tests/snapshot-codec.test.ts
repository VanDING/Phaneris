import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { SnapshotEncoder, SnapshotDecoder } from '../src/utils/snapshot-codec'

const encoder = () => new SnapshotEncoder(value => createHash('sha256').update(value).digest('hex'))
describe('snapshot dictionaries', () => {
  it('round trips changing snapshots without mutation and shares duplicate tools', () => {
    const records = Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, promptSnapshot: `prompt-${i % 2}`, contextSnapshot: { capturedAt: i, tools: [{ name: '读取', schemaChars: 100 }] } }))
    const before = JSON.stringify(records)
    const enc = encoder()
    const packed = records.map(r => enc.encode(r))
    expect(packed[2]!.promptSnapshot).toBeUndefined()
    expect(JSON.stringify(records)).toBe(before)
    const dec = new SnapshotDecoder()
    const restored = packed.map(r => dec.decode<typeof records[0]>(JSON.parse(JSON.stringify(r))))
    expect(restored).toEqual(records)
    expect(restored[0]!.contextSnapshot.tools).toBe(restored[7]!.contextSnapshot.tools)
    expect(new SnapshotDecoder().decode(records[0])).toEqual(records[0])
  })
  it('rejects missing, conflicting, cross-type and unsupported references', () => {
    const id = 'a'.repeat(64)
    const dec = new SnapshotDecoder()
    expect(() => dec.decode({ __craftSnapshotRefs: { version: 1, prompt: id } })).toThrow('Missing')
    dec.decode({ promptSnapshot: 'p', __craftSnapshotRefs: { version: 1, prompt: id } })
    expect(() => dec.decode({ promptSnapshot: 'q', __craftSnapshotRefs: { version: 1, prompt: id } })).toThrow('Conflicting')
    expect(() => dec.decode({ contextSnapshot: {}, __craftSnapshotRefs: { version: 1, tools: id } })).toThrow('wrong type')
    expect(() => dec.decode({ __craftSnapshotRefs: { version: 2 } })).toThrow('Unsupported')
  })
  it('fails closed on encoder hash collisions', () => {
    const enc = new SnapshotEncoder(() => 'a'.repeat(64))
    enc.encode({ promptSnapshot: 'a' })
    expect(() => enc.encode({ promptSnapshot: 'b' })).toThrow('collision')
  })
})
