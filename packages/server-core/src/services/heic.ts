/**
 * HEIC/HEIF support for attachments and thumbnails.
 *
 * Nothing downstream can read HEIC: Chromium cannot decode it, the model APIs
 * reject `image/heic`, and neither `nativeImage` nor `sharp` (as built here)
 * handles it. So a HEIC/HEIF upload is transcoded to JPEG once, up front, and
 * every later step — validation, resize, thumbnail, upload — sees plain JPEG.
 *
 * Three properties this module owns, each learned from a real failure rather
 * than from the format description:
 *
 * 1. **Detection excludes AVIF.** `mif1` is the generic HEIF brand and AVIF
 *    files carry it too, so a brand-only test converts AVIF into JPEG and
 *    silently changes the user's image. The whole `ftyp` brand set is read
 *    (major *and* compatible) and AVIF is excluded explicitly.
 *
 * 2. **Dimensions come from the container, not from a byte scan.** The `ispe`
 *    property that describes the primary image is resolved through
 *    `meta > pitm`, `meta > iprp > ipco` and `meta > iprp > ipma`. Searching for
 *    the literal bytes `ispe` finds a decoy inside any `free` box. Decoding is
 *    refused when the real size cannot be established, because that size is
 *    what bounds the decoder's pixel allocation.
 *
 * 3. **Decoding happens in a terminable worker.** `heic-decode` decodes with
 *    synchronous libheif and `heic-convert` encodes with synchronous `jpeg-js`.
 *    A `Promise.race` on the calling thread cannot interrupt either: the timer
 *    only fires once the synchronous work has already finished. The transcode
 *    therefore runs in a `worker_threads` worker that a deadline can actually
 *    terminate, behind a concurrency limit, with crash and cleanup handling.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { MAX_MESSAGE_PAYLOAD_BYTES } from '@phaneris/shared/protocol';
import { IMAGE_LIMITS } from '@phaneris/shared/utils';

/** Present in a CommonJS bundle, absent from an ES module. */
declare const __filename: string | undefined;

/** MIME types that identify HEIC/HEIF still images and sequences. */
const HEIC_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/** File extensions that identify HEIC/HEIF images. */
const HEIC_EXTENSIONS: ReadonlySet<string> = new Set(['.heic', '.heif']);

/**
 * `ftyp` brands that only HEIC/HEIF encoders emit. A file whose brand set
 * contains one of these (as major or compatible brand) is HEIC.
 */
const HEIC_FTYP_BRANDS: ReadonlySet<string> = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
]);

/** AVIF brands. Any of these anywhere in the brand set means "not HEIC". */
const AVIF_BRANDS: ReadonlySet<string> = new Set(['avif', 'avis', 'av01']);

/** Upper bound on the decode input; matches the transport's message limit. */
export const MAX_HEIC_BYTES = MAX_MESSAGE_PAYLOAD_BYTES;

/** Upper bound on decoded pixels; matches the existing image dimension limit. */
export const MAX_HEIC_PIXELS = IMAGE_LIMITS.MAX_DIMENSION * IMAGE_LIMITS.MAX_DIMENSION;

/** Wall-clock deadline for one transcode. The worker is terminated on expiry. */
export const HEIC_DECODE_TIMEOUT_MS = 20_000;

/** How many transcodes may run at once: each is a thread holding a wasm heap. */
export const HEIC_MAX_CONCURRENT_TRANSCODES = 2;

/** JPEG quality for the transcode. High: this is a one-way format change. */
export const HEIC_JPEG_QUALITY = 0.92;

export function isHeicMime(mimeType?: string | null): boolean {
  return !!mimeType && HEIC_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function isHeicExtension(path: string): boolean {
  return HEIC_EXTENSIONS.has(extname(path).toLowerCase());
}

// ---------------------------------------------------------------------------
// ISO-BMFF parsing
// ---------------------------------------------------------------------------

interface Box {
  type: string;
  /** Offset of the box content (after size/type, and after largesize if used). */
  contentStart: number;
  /** Offset one past the end of the box. */
  end: number;
}

const HEADER_BYTES = 8;
const LARGE_HEADER_BYTES = 16;

/** Iterate the boxes of one container, stopping safely at the first inconsistency. */
function* boxes(buffer: Buffer, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + HEADER_BYTES <= end) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let contentStart = offset + HEADER_BYTES;
    let boxEnd: number;
    if (size === 0) {
      boxEnd = end;
    } else if (size === 1) {
      if (offset + LARGE_HEADER_BYTES > end) return;
      // A 64-bit size whose high word is non-zero cannot fit in this process
      // anyway; stop rather than mis-parse.
      if (buffer.readUInt32BE(offset + 8) !== 0) return;
      contentStart = offset + LARGE_HEADER_BYTES;
      boxEnd = offset + buffer.readUInt32BE(offset + 12);
    } else {
      boxEnd = offset + size;
    }
    if (boxEnd > end || boxEnd <= offset) return;
    yield { type, contentStart, end: boxEnd };
    offset = boxEnd;
  }
}

function findBox(buffer: Buffer, start: number, end: number, type: string): Box | null {
  for (const box of boxes(buffer, start, end)) if (box.type === type) return box;
  return null;
}

interface FtypBrands {
  majorBrand: string;
  compatibleBrands: string[];
}

/** Read the ISO-BMFF `ftyp` brand set, or null when the header is not `ftyp`. */
function readFtypBrands(buffer: Buffer): FtypBrands | null {
  if (buffer.length < 12) return null;
  if (buffer.toString('latin1', 4, 8) !== 'ftyp') return null;
  const declaredSize = buffer.readUInt32BE(0);
  const boxEnd = declaredSize >= 16 && declaredSize <= buffer.length ? declaredSize : buffer.length;
  const compatibleBrands: string[] = [];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    compatibleBrands.push(buffer.toString('latin1', offset, offset + 4).trim());
  }
  return { majorBrand: buffer.toString('latin1', 8, 12).trim(), compatibleBrands };
}

/** All brands the file declares, major first. */
function brandSet(brands: FtypBrands): string[] {
  return [brands.majorBrand, ...brands.compatibleBrands].map((brand) => brand.toLowerCase());
}

/**
 * True when the buffer is an AVIF still image or sequence. Checked before the
 * HEIC test so an AVIF file is never transcoded.
 */
export function isAvifBuffer(buffer: Buffer): boolean {
  const brands = readFtypBrands(buffer);
  if (!brands) return false;
  return brandSet(brands).some((brand) => AVIF_BRANDS.has(brand));
}

/**
 * True when the buffer is HEIC/HEIF (and not AVIF).
 *
 * Requires a HEIC-*specific* brand: the generic `mif1`/`msf1`/`miaf`/`heif`
 * brands alone are not enough, because AVIF and other HEIF payloads carry them
 * too. A file that only declares generic brands is left untouched rather than
 * guessed at.
 */
export function isHeicBuffer(buffer: Buffer): boolean {
  const brands = readFtypBrands(buffer);
  if (!brands) return false;
  const all = brandSet(brands);
  if (all.some((brand) => AVIF_BRANDS.has(brand))) return false;
  if (HEIC_FTYP_BRANDS.has(brands.majorBrand.toLowerCase())) return true;
  return all.some((brand) => HEIC_FTYP_BRANDS.has(brand));
}

/** True when this buffer should go through the HEIC transcode. */
export function needsHeicTranscode(buffer: Buffer, mimeType?: string | null): boolean {
  if (isAvifBuffer(buffer)) return false;
  if (isHeicMime(mimeType)) return true;
  return isHeicBuffer(buffer);
}

/** `pitm` — the id of the image item a reader should present. */
function readPrimaryItemId(buffer: Buffer, metaContent: number, metaEnd: number): number | null {
  const pitm = findBox(buffer, metaContent, metaEnd, 'pitm');
  if (!pitm) return null;
  const version = buffer.readUInt8(pitm.contentStart);
  const at = pitm.contentStart + 4;
  if (version === 0) {
    if (at + 2 > pitm.end) return null;
    return buffer.readUInt16BE(at);
  }
  if (at + 4 > pitm.end) return null;
  return buffer.readUInt32BE(at);
}

/** `ipco` — the property container, in the order `ipma` indexes into it. */
function readIspeProperties(buffer: Buffer, ipco: Box): Map<number, { width: number; height: number }> {
  const properties = new Map<number, { width: number; height: number }>();
  let index = 0;
  for (const property of boxes(buffer, ipco.contentStart, ipco.end)) {
    index++;
    if (property.type !== 'ispe') continue;
    // `ispe` is a FullBox: 4 bytes of version/flags, then width, then height.
    const at = property.contentStart + 4;
    if (at + 8 > property.end) continue;
    const width = buffer.readUInt32BE(at);
    const height = buffer.readUInt32BE(at + 4);
    if (width > 0 && height > 0 && width <= 0xffff && height <= 0xffff) properties.set(index, { width, height });
  }
  return properties;
}

interface PropertyAssociation {
  essential: boolean;
  propertyIndex: number;
}

/** `ipma` — which properties belong to which item. */
function readPropertyAssociations(buffer: Buffer, ipma: Box): Map<number, PropertyAssociation[]> {
  const associations = new Map<number, PropertyAssociation[]>();
  const version = buffer.readUInt8(ipma.contentStart);
  // Two independent widths, per libheif's Box_ipma::parse: the FullBox `version`
  // picks the item-ID width and `flags & 1` picks the property-association width.
  // Reading both from `version` mis-parses the legal version=0/flags=1 and
  // version=1/flags=0 files and rejects decodable images.
  const flags = buffer.readUIntBE(ipma.contentStart + 1, 3);
  const wideAssociations = (flags & 1) === 1;
  let at = ipma.contentStart + 4;
  if (at + 4 > ipma.end) return associations;
  const entryCount = buffer.readUInt32BE(at);
  at += 4;
  for (let entry = 0; entry < entryCount; entry++) {
    const itemBytes = version < 1 ? 2 : 4;
    if (at + itemBytes + 1 > ipma.end) return associations;
    const itemId = itemBytes === 2 ? buffer.readUInt16BE(at) : buffer.readUInt32BE(at);
    at += itemBytes;
    const associationCount = buffer.readUInt8(at);
    at += 1;
    const list: PropertyAssociation[] = [];
    for (let i = 0; i < associationCount; i++) {
      const associationBytes = wideAssociations ? 2 : 1;
      if (at + associationBytes > ipma.end) {
        associations.set(itemId, list);
        return associations;
      }
      const raw = associationBytes === 1 ? buffer.readUInt8(at) : buffer.readUInt16BE(at);
      at += associationBytes;
      const essentialMask = associationBytes === 1 ? 0x80 : 0x8000;
      const indexMask = associationBytes === 1 ? 0x7f : 0x7fff;
      list.push({ essential: (raw & essentialMask) !== 0, propertyIndex: raw & indexMask });
    }
    associations.set(itemId, list);
  }
  return associations;
}

/**
 * Dimensions of the primary image, resolved through the container's own item
 * tables. Returns null when the file does not describe them — the caller must
 * treat that as "cannot bound the decode", not as "unbounded is fine".
 */
export function readHeicDimensions(buffer: Buffer): { width: number; height: number } | null {
  const meta = findBox(buffer, 0, buffer.length, 'meta');
  if (!meta) return null;
  // `meta` is a FullBox: 4 bytes of version/flags before its children.
  const childrenStart = meta.contentStart + 4;
  if (childrenStart > meta.end) return null;
  const primaryItemId = readPrimaryItemId(buffer, childrenStart, meta.end);
  if (primaryItemId === null) return null;
  const iprp = findBox(buffer, childrenStart, meta.end, 'iprp');
  if (!iprp) return null;
  const ipco = findBox(buffer, iprp.contentStart, iprp.end, 'ipco');
  const ipma = findBox(buffer, iprp.contentStart, iprp.end, 'ipma');
  if (!ipco || !ipma) return null;
  const properties = readIspeProperties(buffer, ipco);
  if (properties.size === 0) return null;
  const itemAssociations = readPropertyAssociations(buffer, ipma).get(primaryItemId);
  if (!itemAssociations) return null;
  for (const association of itemAssociations) {
    const property = properties.get(association.propertyIndex);
    if (property) return property;
  }
  return null;
}

function describe(buffer: Buffer): string {
  const brands = readFtypBrands(buffer);
  return brands ? `${brands.majorBrand} [${brands.compatibleBrands.join(' ')}]` : 'unknown';
}

// ---------------------------------------------------------------------------
// Bounded transcode
// ---------------------------------------------------------------------------

/**
 * The worker body. It runs as CommonJS (that is what `eval: true` gives), so
 * `require` resolves the absolute decoder path the parent resolved — the one
 * thing a bundled process cannot resolve for itself from another thread.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const loaded = require(workerData.modulePath)
const convert = typeof loaded === 'function' ? loaded : loaded.default
Promise.resolve()
  .then(() => convert({ buffer: Buffer.from(workerData.buffer), format: 'JPEG', quality: workerData.quality }))
  .then((output) => {
    // Small Buffer.from results can use Node's untransferable pooled backing
    // store. An owned Uint8Array is transferable in Electron as well as Bun.
    const bytes = Uint8Array.from(output)
    parentPort.postMessage({ ok: true, bytes }, [bytes.buffer])
  })
  .catch((error) => {
    parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) })
  })
`;

let cachedDecoderModulePath: string | null = null;

/**
 * Directories the packaged app stages the external decoder into.
 *
 * Every entry is derived from a runtime-provided location, never from the
 * working directory: a bundle launched from the executable's own folder or from
 * an unrelated directory must still find the decoder it shipped with, and must
 * never fall back to a development checkout that happens to be an ancestor of
 * wherever it was started.
 */
function packagedDecoderBases(): string[] {
  const bases: string[] = [];
  const push = (value: string | undefined | null) => {
    if (typeof value === 'string' && value.length > 0 && !bases.includes(value)) bases.push(value);
  };
  // Electron main sets this at startup: `<resources>/app` when packaged.
  push(process.env.PHANERIS_RESOURCES_BASE);
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (typeof resourcesPath === 'string') push(join(resourcesPath, 'app'));
  // Only trusted as an app location when the process says it is packaged; in dev
  // it is the working directory, which is exactly what must not decide this.
  if (process.env.PHANERIS_IS_PACKAGED === '1') push(process.env.PHANERIS_APP_ROOT);
  // A portable build keeps `resources` beside its executable.
  if (typeof process.execPath === 'string' && process.execPath.length > 0) {
    push(join(dirname(process.execPath), 'resources', 'app'));
    push(join(dirname(process.execPath), 'resources'));
  }
  return bases;
}

/**
 * Files whose location can anchor ordinary Node resolution: the module's own
 * URL in an ES module, its filename in a CommonJS bundle, the entry script when
 * neither is available. These cover a development checkout and the headless
 * server, where the decoder is hoisted into the repository's `node_modules`.
 */
function moduleLocalBases(): string[] {
  const bases: string[] = [];
  try {
    const url = import.meta.url;
    if (typeof url === 'string' && url.length > 0) bases.push(fileURLToPath(url));
  } catch { /* CommonJS bundle: import.meta is not available */ }
  if (typeof __filename === 'string' && __filename.length > 0) bases.push(__filename);
  const entry = process.argv[1];
  if (typeof entry === 'string' && entry.length > 0 && existsSync(entry)) bases.push(entry);
  return bases;
}

/**
 * Resolve the decoder from where the application actually keeps it.
 *
 * The packaged app stages `heic-convert` at `<app>/node_modules/heic-convert`
 * (electron-builder `extraResources`), so the staged path is checked directly —
 * resolution by ancestor climbing would happily find a development checkout
 * instead. Module-relative resolution remains the dev/headless path.
 */
export function resolveHeicDecoderModule(): string {
  if (cachedDecoderModulePath) return cachedDecoderModulePath;
  const failures: string[] = [];
  for (const base of packagedDecoderBases()) {
    const staged = join(base, 'node_modules', 'heic-convert', 'index.js');
    if (existsSync(staged)) {
      cachedDecoderModulePath = staged;
      return staged;
    }
    try {
      cachedDecoderModulePath = createRequire(join(base, 'index.cjs')).resolve('heic-convert');
      return cachedDecoderModulePath;
    } catch (error) {
      failures.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const base of moduleLocalBases()) {
    try {
      cachedDecoderModulePath = createRequire(base).resolve('heic-convert');
      return cachedDecoderModulePath;
    } catch (error) {
      failures.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    'HEIC/HEIF support is unavailable: the heic-convert decoder could not be resolved '
    + `(tried ${failures.length} base path(s): ${failures.join('; ')})`,
  );
}

let activeTranscodes = 0;
const waiters: (() => void)[] = [];

/** Counters the verification workflows read; never used to make decisions. */
export const heicTranscodeStats = { started: 0, completed: 0, terminated: 0, failed: 0, maxConcurrent: 0 };

async function acquireSlot(): Promise<void> {
  while (activeTranscodes >= HEIC_MAX_CONCURRENT_TRANSCODES) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeTranscodes++;
  heicTranscodeStats.maxConcurrent = Math.max(heicTranscodeStats.maxConcurrent, activeTranscodes);
}

function releaseSlot(): void {
  activeTranscodes--;
  const next = waiters.shift();
  if (next) next();
}

/** One transcode, in a worker that a deadline can actually terminate. */
async function transcodeInWorker(buffer: Buffer, quality: number, timeoutMs: number): Promise<Buffer> {
  const modulePath = resolveHeicDecoderModule();
  heicTranscodeStats.started++;
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { modulePath, buffer, quality },
    // The worker only decodes and encodes; keep its heap bounded so a hostile
    // file fails the worker rather than the whole process.
    resourceLimits: { maxOldGenerationSizeMb: 2048 },
  });
  let settled = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const finish = (error: Error | null, bytes?: Buffer) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(bytes as Buffer);
      };
      timer = setTimeout(() => {
        timedOut = true;
        heicTranscodeStats.terminated++;
        // Terminating the worker is what actually stops the synchronous libheif
        // decode and jpeg-js encode; rejecting the promise alone would not.
        void worker.terminate().then(
          () => finish(new Error(`HEIC/HEIF decode exceeded ${timeoutMs} ms and was terminated`)),
          () => finish(new Error(`HEIC/HEIF decode exceeded ${timeoutMs} ms and could not be terminated`)),
        );
      }, timeoutMs);
      worker.on('message', (message: { ok: boolean; bytes?: Buffer; error?: string }) => {
        if (timedOut || settled) return;
        if (message.ok && message.bytes) {
          heicTranscodeStats.completed++;
          finish(null, Buffer.from(message.bytes));
        } else {
          heicTranscodeStats.failed++;
          finish(new Error(message.error ?? 'HEIC/HEIF decoder failed'));
        }
      });
      worker.on('error', (error) => {
        // After the result has settled the finally block terminates the worker;
        // a late error or a non-zero exit from that termination is cleanup, not a
        // failed transcode, and counting it inflated the diagnostics.
        if (settled || timedOut) return;
        heicTranscodeStats.failed++;
        finish(error instanceof Error ? error : new Error(String(error)));
      });
      worker.on('exit', (code) => {
        if (settled || timedOut) return;
        if (code !== 0) {
          heicTranscodeStats.failed++;
          finish(new Error(`HEIC/HEIF decoder exited with code ${code}`));
        }
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    // Idempotent: covers the timeout, the error path and a worker already gone.
    await worker.terminate().catch(() => {});
  }
}

/** Decode the primary image of a HEIC/HEIF buffer to a JPEG buffer. */
export async function decodeHeicToJpeg(
  buffer: Buffer,
  quality = HEIC_JPEG_QUALITY,
  timeoutMs = HEIC_DECODE_TIMEOUT_MS,
): Promise<Buffer> {
  if (buffer.length === 0) throw new Error('HEIC/HEIF image is empty');
  if (buffer.length > MAX_HEIC_BYTES) {
    throw new Error(
      `HEIC/HEIF image is ${(buffer.length / 1024 / 1024).toFixed(1)} MiB, over the `
      + `${(MAX_HEIC_BYTES / 1024 / 1024).toFixed(0)} MiB attachment limit`,
    );
  }
  const dimensions = readHeicDimensions(buffer);
  if (!dimensions) {
    // Fail closed: without the container's own dimensions there is no bound on
    // what the decoder is about to allocate.
    throw new Error(
      `Could not determine the image dimensions of this HEIC/HEIF file (brand ${describe(buffer)}); `
      + 'refusing to decode it without a size bound',
    );
  }
  if (dimensions.width * dimensions.height > MAX_HEIC_PIXELS) {
    throw new Error(
      `HEIC/HEIF image is ${dimensions.width}x${dimensions.height} `
      + `(${Math.round((dimensions.width * dimensions.height) / 1_000_000)}MP), over the `
      + `${IMAGE_LIMITS.MAX_DIMENSION}x${IMAGE_LIMITS.MAX_DIMENSION} pixel limit`,
    );
  }

  await acquireSlot();
  let jpeg: Buffer;
  try {
    jpeg = await transcodeInWorker(buffer, quality, timeoutMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not decode HEIC/HEIF image (brand ${describe(buffer)}): ${reason}`);
  } finally {
    releaseSlot();
  }
  // Format verification: never hand a caller something that is not a JPEG.
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error(`HEIC/HEIF decode produced a non-JPEG result (brand ${describe(buffer)})`);
  }
  return jpeg;
}

/**
 * Return bytes/path the platform image processors can decode.
 *
 * Electron's `nativeImage` and headless `sharp` both fail on HEIC by returning
 * an empty image or throwing, which would drop the attachment. Every processor
 * entry point therefore normalizes first.
 */
export async function ensureDecodableImage(input: Buffer | string): Promise<Buffer | string> {
  if (typeof input === 'string') {
    if (!isHeicExtension(input)) return input;
    const size = statSync(input).size;
    if (size > MAX_HEIC_BYTES) throw new Error(`HEIC/HEIF file is ${size} bytes, over the attachment limit`);
    return await decodeHeicToJpeg(readFileSync(input));
  }
  if (!needsHeicTranscode(input)) return input;
  return await decodeHeicToJpeg(input);
}
