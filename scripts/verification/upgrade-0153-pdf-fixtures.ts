#!/usr/bin/env bun
/**
 * Rebuildable PDF fixtures for the upgrade-0153 PDF acceptance workflow
 * (`scripts/verification/upgrade-0153-pdf-workflow.ts`).
 *
 * Usage:
 *   bun run scripts/verification/upgrade-0153-pdf-fixtures.ts [--out=<dir>]
 *
 * Everything is produced by one PEP 723 script executed through the isolated
 * uv (`uv run --offline --python 3.12.15 --quiet -`), so the fixtures are
 * byte-reproducible and need no network:
 *
 *   normal.pdf     3 pages of selectable Helvetica text, one unique marker per
 *                  page, US Letter (612x792), plus an /Info dictionary
 *   encrypted.pdf  normal.pdf re-written by pypdf's own encryption handler
 *                  (user password "user", owner password "owner")
 *   form.pdf       a real AcroForm: two /Tx fields (`full_name`, `email`) as
 *                  merged field/widget annotations, with /DA and /DR fonts
 *   truncated.pdf  normal.pdf cut at 60% of its length, strictly inside an
 *                  unterminated content stream (recorded in the manifest)
 *   cyclic.pdf     a hand-written page tree whose /Pages node lists itself as
 *                  one of its own /Kids (see the manifest's `construction`)
 *   manifest.json  sha256 + byte size per file, plus generation metadata
 *
 * Why pypdf and not reportlab: reportlab is NOT in the uv cache on this
 * machine (verified: `uv run --offline ... reportlab` → "reportlab was not
 * found in the cache ... the network was disabled"). pypdf 6.21.1 is already
 * pinned by the shipped tool (`apps/electron/resources/scripts/pdf_tool.py`
 * PEP 723 header) and is cached, so the generator stays offline and adds no
 * new dependency. Structural fixtures (normal, form, truncated, cyclic) are
 * raw object graphs assembled byte by byte; only the encrypted fixture uses a
 * library writer.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const arg = (name: string) => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const out = resolve(root, arg('out') ?? '.cache/upgrade-20261018/pdf-fixtures')
mkdirSync(out, { recursive: true })

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

/** uv, preferring the binary this repo ships over whatever is on PATH. */
function resolveUv(): string {
  const platformKey = `${process.platform}-${process.arch}`
  const packaged = join(root, 'apps/electron/resources/bin', platformKey, process.platform === 'win32' ? 'uv.exe' : 'uv')
  if (existsSync(packaged)) return packaged
  return process.platform === 'win32' ? 'uv.exe' : 'uv'
}

/** PEP 723 fixture builder. `--offline` proves the run needs no network. */
const builder = String.raw`
# /// script
# requires-python = ">=3.12"
# dependencies = ["pypdf==6.21.1"]
# ///
"""Build the upgrade-0153 PDF acceptance fixtures (see the .ts header)."""

import json
import re
import sys
from pathlib import Path

import pypdf
from pypdf import PdfReader, PdfWriter

OUT = Path(${JSON.stringify(out)})
WIDTH = 612.0
HEIGHT = 792.0
FONT_HELVETICA = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"


def escape(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(objects, root_ref="1 0 R", info_ref=None):
    """Serialise a {number: body-bytes} mapping into a PDF with a classic xref table."""
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += ("%d 0 obj\n" % number).encode("latin-1")
        out += objects[number]
        out += b"\nendobj\n"
    xref_at = len(out)
    size = max(objects) + 1
    out += b"xref\n"
    out += ("0 %d\n" % size).encode("latin-1")
    out += b"0000000000 65535 f \n"
    for number in range(1, size):
        if number in offsets:
            out += ("%010d 00000 n \n" % offsets[number]).encode("latin-1")
        else:
            out += b"0000000000 65535 f \n"
    trailer = "<< /Size %d /Root %s" % (size, root_ref)
    if info_ref is not None:
        trailer += " /Info %s" % info_ref
    trailer += " >>"
    out += ("trailer\n%s\nstartxref\n%d\n%%%%EOF\n" % (trailer, xref_at)).encode("latin-1")
    return bytes(out)


def stream_object(data, extra=""):
    head = "<< /Length %d%s >>\nstream\n" % (len(data), (" " + extra) if extra else "")
    return head.encode("latin-1") + data + b"\nendstream"


def text_stream(text, size=18, x=72, y=700):
    body = (
        "BT\n/F1 %d Tf\n%d %d Td\n(%s) Tj\n0 -28 Td\n/F1 11 Tf\n(%s) Tj\nET\n"
        % (size, x, y, escape(text), escape("Phaneris PDF acceptance fixture - selectable text control - " + text))
    )
    return body.encode("latin-1")


def page_object(parent, contents, font, extra=""):
    return (
        "<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %g %g] "
        "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R%s >>"
        % (parent, WIDTH, HEIGHT, font, contents, extra)
    ).encode("latin-1")


report = {"pypdf": pypdf.__version__, "python": sys.version.split()[0], "fixtures": {}}

# --- F1: normal.pdf, three pages of selectable text -------------------------
NORMAL_MARKERS = [
    "PHANERIS-PDF01-MARKER-ALPHA",
    "PHANERIS-PDF01-MARKER-BRAVO",
    "PHANERIS-PDF01-MARKER-CHARLIE",
]
normal_objects = {
    1: b"<< /Type /Catalog /Pages 2 0 R >>",
    2: b"<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
    3: page_object(2, 4, 9),
    4: stream_object(text_stream(NORMAL_MARKERS[0])),
    5: page_object(2, 6, 9),
    6: stream_object(text_stream(NORMAL_MARKERS[1])),
    7: page_object(2, 8, 9),
    8: stream_object(text_stream(NORMAL_MARKERS[2])),
    9: FONT_HELVETICA,
    10: (
        b"<< /Title (Phaneris PDF verification fixture F1) /Author (verification)"
        b" /Producer (upgrade-0153-pdf-fixtures) /Creator (upgrade-0153-pdf-fixtures) >>"
    ),
}
normal_bytes = build_pdf(normal_objects, info_ref="10 0 R")
(OUT / "normal.pdf").write_bytes(normal_bytes)
normal_reader = PdfReader(str(OUT / "normal.pdf"))
normal_pages = len(normal_reader.pages)
assert normal_pages == 3, "normal.pdf must have 3 pages, got %d" % normal_pages
assert [round(float(v)) for v in normal_reader.pages[0].mediabox] == [0, 0, 612, 792]
report["fixtures"]["normal.pdf"] = {
    "pages": normal_pages,
    "markers": NORMAL_MARKERS,
    "pageSize": {"width": float(normal_reader.pages[0].mediabox.width), "height": float(normal_reader.pages[0].mediabox.height)},
    "construction": "raw object graph: catalog -> /Pages -> 3 /Page objects, each with a Helvetica /Contents stream holding one unique marker",
}

# --- F2: encrypted.pdf, from the F1 bytes -----------------------------------
writer = PdfWriter()
writer.append(PdfReader(str(OUT / "normal.pdf")))
# AES is deliberately not requested: pypdf's AES paths need cryptography>=3.1,
# which is not in the uv cache, and this generator runs --offline. RC4-128 is
# pypdf's own default and is enough for a password-protected fixture.
writer.encrypt(user_password="user", owner_password="owner")
with open(OUT / "encrypted.pdf", "wb") as handle:
    writer.write(handle)
encrypted_path = OUT / "encrypted.pdf"
locked = PdfReader(str(encrypted_path))
assert locked.is_encrypted, "encrypted.pdf must report is_encrypted"
unlocked = PdfReader(str(encrypted_path), password="user")
assert len(unlocked.pages) == 3, "encrypted.pdf must open with the user password"
encrypt_dict = locked.trailer["/Encrypt"]
report["fixtures"]["encrypted.pdf"] = {
    "pages": 3,
    "userPassword": "user",
    "ownerPassword": "owner",
    "algorithm": "RC4-128 (pypdf default)",
    "encryptDictionary": {"V": str(encrypt_dict.get("/V")), "R": str(encrypt_dict.get("/R")), "Length": str(encrypt_dict.get("/Length", ""))},
    "construction": "pypdf PdfWriter.encrypt(user_password='user', owner_password='owner') over the F1 object graph; AES-256 was rejected because pypdf requires cryptography>=3.1 for AES and that package is not in the uv cache (offline run)",
}

# --- F3: form.pdf, a real AcroForm with two text fields ---------------------
FORM_FIELDS = [("full_name", "Ada Lovelace"), ("email", "ada@example.com")]
FORM_LABEL = "PHANERIS-PDF03-FORM-LABEL"


def widget(field, rect, page=3):
    return (
        "<< /Type /Annot /Subtype /Widget /FT /Tx /T (%s) /V () /Rect [%g %g %g %g] "
        "/F 4 /P %d 0 R /DA (/Helv 0 Tf 0 g) >>" % (field, rect[0], rect[1], rect[2], rect[3], page)
    ).encode("latin-1")


form_objects = {
    1: (
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R] /DA (/Helv 0 Tf 0 g) "
        b"/DR << /Font << /Helv 7 0 R >> >> /NeedAppearances false >> >>"
    ),
    2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: page_object(2, 4, 7, extra=" /Annots [5 0 R 6 0 R]"),
    4: stream_object(text_stream(FORM_LABEL)),
    5: widget("full_name", (72.0, 640.0, 372.0, 668.0)),
    6: widget("email", (72.0, 580.0, 372.0, 608.0)),
    7: FONT_HELVETICA,
}
(OUT / "form.pdf").write_bytes(build_pdf(form_objects))
form_fields = PdfReader(str(OUT / "form.pdf")).get_fields()
assert sorted(form_fields) == ["email", "full_name"], "form.pdf fields: %s" % sorted(form_fields)
report["fixtures"]["form.pdf"] = {
    "pages": 1,
    "fields": [{"name": name, "type": str(form_fields[name].get("/FT")), "value": str(form_fields[name].get("/V", ""))} for name in sorted(form_fields)],
    "label": FORM_LABEL,
    "construction": "raw object graph: catalog /AcroForm /Fields [5 0 R 6 0 R] with two merged field+widget /Tx annotations on page 3 0 R",
}

# --- F4: truncated.pdf, cut strictly inside an unterminated stream ----------
cut = int(len(normal_bytes) * 0.6)
truncated = normal_bytes[:cut]
(OUT / "truncated.pdf").write_bytes(truncated)
stream_starts = [m.start() for m in re.finditer(rb"stream", truncated) if truncated[m.start() - 3 : m.start()] != b"end"]
assert stream_starts, "truncated.pdf must cut inside a content stream"
cut_object = re.findall(rb"(\d+) 0 obj", truncated)
# The fixture is only meaningful if the 60% cut really splits an object: assert
# instead of trusting the arithmetic of the layout above.
assert b"endstream" not in truncated[stream_starts[-1] + 6 :], "truncated.pdf cut must leave the last content stream unterminated"
report["fixtures"]["truncated.pdf"] = {
    "sourceBytes": len(normal_bytes),
    "cutOffset": cut,
    "cutObject": int(cut_object[-1]) if cut_object else None,
    "insideUnterminatedStream": True,
    "streamStartOffset": stream_starts[-1],
    "construction": "normal.pdf truncated to 60% of its byte length, which lands inside the last page's content stream: no endstream, no endobj, no xref and no %%EOF survive",
}

# --- F5: cyclic.pdf, a /Pages node that is its own descendant ---------------
CYCLIC_MARKERS = ["PHANERIS-PDF05-CYCLIC-A", "PHANERIS-PDF05-CYCLIC-C"]
cyclic_objects = {
    1: b"<< /Type /Catalog /Pages 2 0 R >>",
    # The root /Pages node lists the child /Pages node 6 0 R ...
    2: b"<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 4 >>",
    3: page_object(2, 4, 5),
    4: stream_object(text_stream(CYCLIC_MARKERS[0])),
    5: FONT_HELVETICA,
    # ... and 6 0 R lists the root 2 0 R back among its own /Kids: 2 -> 6 -> 2.
    6: b"<< /Type /Pages /Parent 2 0 R /Kids [3 0 R 2 0 R 7 0 R] /Count 3 >>",
    7: page_object(6, 8, 5),
    8: stream_object(text_stream(CYCLIC_MARKERS[1])),
}
(OUT / "cyclic.pdf").write_bytes(build_pdf(cyclic_objects))
report["fixtures"]["cyclic.pdf"] = {
    "markers": CYCLIC_MARKERS,
    "construction": (
        "hand-written object graph: catalog 1 0 R -> root /Pages 2 0 R with /Kids [3 0 R 6 0 R]; "
        "child /Pages 6 0 R declares /Parent 2 0 R and /Kids [3 0 R 2 0 R 7 0 R], so the root is one of its "
        "own descendants (cycle 2 -> 6 -> 2) and page 3 0 R is reachable twice; /Count values (4 and 3) do not "
        "match the reachable page set. The xref table and trailer are well-formed, so the file parses but a "
        "naive recursive page-tree walk never terminates."
    ),
    "cycle": ["2 0 R", "6 0 R", "2 0 R"],
    "rootCount": 4,
    "childCount": 3,
}

print(json.dumps(report, sort_keys=True))
`

const uv = resolveUv()
const uvArgs = ['run', '--offline', '--python', '3.12.15', '--quiet', '-']
const stdout = execFileSync(uv, uvArgs, {
  input: builder,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'inherit'],
  timeout: 600_000,
})

const builderReport = JSON.parse(stdout.trim()) as {
  pypdf: string
  python: string
  fixtures: Record<string, Record<string, unknown>>
}

const names = ['normal.pdf', 'encrypted.pdf', 'form.pdf', 'truncated.pdf', 'cyclic.pdf']
const fixtures = Object.fromEntries(names.map(name => {
  const bytes = readFileSync(join(out, name))
  return [name, { path: name, bytes: bytes.byteLength, sha256: sha256(bytes), ...builderReport.fixtures[name] }]
}))

const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  generator: 'scripts/verification/upgrade-0153-pdf-fixtures.ts',
  generatorCommand: `bun run scripts/verification/upgrade-0153-pdf-fixtures.ts --out=${out}`,
  fixturesDir: out,
  python: {
    runtime: `uv run --offline --python 3.12.15 --quiet -`,
    uv,
    pypdf: builderReport.pypdf,
    python: builderReport.python,
    note: 'reportlab is absent from the uv cache, so every fixture is built with pypdf 6.21.1 (already pinned by pdf_tool.py) — --offline proves no network was used',
  },
  fixtures,
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({
  out,
  uv: `${uv} ${uvArgs.join(' ')}`,
  fixtures: Object.fromEntries(names.map(name => [name, { bytes: fixtures[name]!.bytes, sha256: fixtures[name]!.sha256 }])),
}, null, 2))
