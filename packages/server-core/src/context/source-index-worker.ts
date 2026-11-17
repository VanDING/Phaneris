/** No module resolution or application state in the worker. It produces only
 * rebuildable byte locators; the owner verifies the file generation on return. */
export const SOURCE_INDEX_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const signature = file => { const s = fs.statSync(file); return JSON.stringify([s.ino, s.size, s.mtimeMs, s.ctimeMs]); };
const results = workerData.map(file => {
  let fd, before, bytesRead = 0, decodedRecords = 0;
  try {
    before = signature(file);
    const entries = [];
    let pending = Buffer.alloc(0), position = 0, header;
    const consume = line => {
      if (!line.length) return;
      const parsed = JSON.parse(line.toString('utf8')); decodedRecords++;
      if (!header) header = parsed;
      else entries.push({ id: parsed.id, offset: position, length: line.length, version: createHash('sha256').update(line).digest('hex') });
    };
    fd = fs.openSync(file, 'r');
    for (;;) {
      const block = Buffer.allocUnsafe(65536), count = fs.readSync(fd, block, 0, block.length, null);
      if (!count) break;
      bytesRead += count; pending = Buffer.concat([pending, block.subarray(0, count)]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) { consume(pending.subarray(0, newline)); position += newline + 1; pending = pending.subarray(newline + 1); }
    }
    if (pending.length) consume(pending);
    if (!header || signature(file) !== before) throw new Error('source_revision_conflict: Source changed while warming');
    return { file, signature: before, header, entries, bytesRead, decodedRecords };
  } catch (error) { return { file, signature: before, bytesRead, decodedRecords, error: error instanceof Error ? error.message : String(error) }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
});
parentPort.postMessage(results);
`
