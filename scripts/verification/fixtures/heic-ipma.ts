import assert from 'node:assert/strict'

/** Re-encode the actual encoder's association table, preserving image extents. */
export function withIpmaWidths(source: Buffer, version: 0 | 1, wide: boolean): Buffer {
  const find = (bytes: Buffer, start: number, end: number, type: string) => {
    for (let at = start; at + 8 <= end;) {
      const size = bytes.readUInt32BE(at)
      assert(size >= 8 && at + size <= end, 'fixture must have ordinary bounded boxes')
      if (bytes.toString('latin1', at + 4, at + 8) === type) return { at, end: at + size }
      at += size
    }
    throw new Error(`Missing fixture box ${type}`)
  }
  const meta = find(source, 0, source.length, 'meta')
  const iprp = find(source, meta.at + 12, meta.end, 'iprp')
  const ipma = find(source, iprp.at + 8, iprp.end, 'ipma')
  const oldVersion = source[ipma.at + 8]!
  const oldWide = (source.readUIntBE(ipma.at + 9, 3) & 1) !== 0
  const count = source.readUInt32BE(ipma.at + 12)
  const entries: Buffer[] = []
  let cursor = ipma.at + 16
  for (let item = 0; item < count; item++) {
    const idBytes = oldVersion === 0 ? 2 : 4
    const id = source.readUIntBE(cursor, idBytes)
    cursor += idBytes
    const associations = source[cursor++]!
    const record = Buffer.alloc((version === 0 ? 2 : 4) + 1 + associations * (wide ? 2 : 1))
    record.writeUIntBE(id, 0, version === 0 ? 2 : 4)
    let target = version === 0 ? 2 : 4
    record[target++] = associations
    for (let property = 0; property < associations; property++) {
      const raw = source.readUIntBE(cursor, oldWide ? 2 : 1)
      cursor += oldWide ? 2 : 1
      const index = raw & (oldWide ? 0x7fff : 0x7f)
      const essential = (raw & (oldWide ? 0x8000 : 0x80)) !== 0
      record.writeUIntBE(index | (essential ? (wide ? 0x8000 : 0x80) : 0), target, wide ? 2 : 1)
      target += wide ? 2 : 1
    }
    entries.push(record)
  }
  assert.equal(cursor, ipma.end)
  const header = Buffer.alloc(16)
  header.writeUInt32BE(16 + entries.reduce((n, entry) => n + entry.length, 0))
  header.write('ipma', 4, 'latin1')
  header[8] = version
  header[11] = wide ? 1 : 0
  header.writeUInt32BE(count, 12)
  const replacement = Buffer.concat([header, ...entries])
  const delta = replacement.length - (ipma.end - ipma.at)
  const result = Buffer.concat([source.subarray(0, ipma.at), replacement, source.subarray(ipma.end)])
  result.writeUInt32BE(meta.end - meta.at + delta, meta.at)
  result.writeUInt32BE(iprp.end - iprp.at + delta, iprp.at)

  // iloc construction_method=0 references absolute mdat offsets. Its table may
  // sit on either side of iprp; locate it again after rebuilding the container.
  const iloc = find(result, meta.at + 12, meta.end + delta, 'iloc')
  const ilocVersion = result[iloc.at + 8]!
  cursor = iloc.at + 12
  const offsetSize = result[cursor]! >> 4
  const lengthSize = result[cursor++]! & 15
  const baseSize = result[cursor]! >> 4
  const indexSize = ilocVersion > 0 ? result[cursor]! & 15 : 0
  cursor++
  const itemCountSize = ilocVersion < 2 ? 2 : 4
  const itemCount = result.readUIntBE(cursor, itemCountSize)
  cursor += itemCountSize
  for (let item = 0; item < itemCount; item++) {
    cursor += ilocVersion < 2 ? 2 : 4
    const method = ilocVersion > 0 ? result.readUInt16BE(cursor) & 15 : 0
    if (ilocVersion > 0) cursor += 2
    const dataReference = result.readUInt16BE(cursor)
    cursor += 2
    const baseAt = cursor
    const base = baseSize ? Number(result.readUIntBE(cursor, baseSize)) : 0
    cursor += baseSize
    const extents = result.readUInt16BE(cursor)
    cursor += 2
    if (method === 0 && dataReference === 0 && base >= ipma.end && baseSize)
      result.writeUIntBE(base + delta, baseAt, baseSize)
    for (let extent = 0; extent < extents; extent++) {
      cursor += indexSize
      if (method === 0 && dataReference === 0 && base < ipma.end && offsetSize) {
        const offset = result.readUIntBE(cursor, offsetSize)
        if (base + offset >= ipma.end) result.writeUIntBE(offset + delta, cursor, offsetSize)
      }
      cursor += offsetSize + lengthSize
    }
  }
  assert.equal(cursor, iloc.end)
  return result
}
