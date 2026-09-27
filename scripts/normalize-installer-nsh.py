"""Normalise the installer's NSIS *code* files to pure ASCII.

Why this exists: NSIS reads `!include`d files with the system ANSI codepage
unless the file carries a UTF-8 BOM, and `-INPUTCHARSET UTF8` only covers the
top-level script. A BOM is therefore load-bearing -- but it is invisible, easy to
strip (any editor, any patch tool, `git checkout` with the wrong settings), and
losing it produces "Bad text encoding" pointing at an innocent line.

So: only `installer-strings.nsh`, which genuinely contains Chinese product copy,
keeps a BOM. Every other .nsh/.nsi here stays plain ASCII, which needs none, and
this script enforces that by rewriting the typographic punctuation that creeps
into comments (em dashes, arrows, ellipses, curly quotes).

Run after editing any installer .nsh:  python scripts/normalize-installer-nsh.py
"""

import pathlib
import sys

INSTALLER = pathlib.Path(r"E:\Phaneris\apps\electron\installer")
SCRIPTS = pathlib.Path(r"E:\Phaneris\apps\electron\scripts")

# Files that must be ASCII-only (no BOM needed).
ASCII_FILES = [
    INSTALLER / "installer-pages.nsh",
    INSTALLER / "probe.nsi",
    SCRIPTS / "installer.nsh",
]
# Files that must be UTF-8 *with* a BOM, because they carry translations.
BOM_FILES = [INSTALLER / "installer-strings.nsh"]

REPLACEMENTS = {
    "\u2014": "--",   # em dash
    "\u2013": "-",    # en dash
    "\u2192": "->",   # rightwards arrow
    "\u2026": "...",  # horizontal ellipsis
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u00d7": "x",
    "\u2212": "-",
    "\u00a0": " ",    # non-breaking space
}

BOM = b"\xef\xbb\xbf"
failed = False


def strip_bom(raw: bytes) -> bytes:
    return raw[3:] if raw.startswith(BOM) else raw


for path in ASCII_FILES:
    text = strip_bom(path.read_bytes()).decode("utf-8")
    for bad, good in REPLACEMENTS.items():
        text = text.replace(bad, good)
    remaining = sorted({c for c in text if ord(c) > 127})
    if remaining:
        failed = True
        print(f"  !! {path.name}: still non-ASCII: {remaining}")
    path.write_bytes(text.encode("utf-8"))
    print(f"  ok {path.name}: ASCII")

for path in BOM_FILES:
    raw = strip_bom(path.read_bytes())
    path.write_bytes(BOM + raw)
    non_ascii = sum(1 for b in raw if b > 127)
    print(f"  ok {path.name}: UTF-8 + BOM ({non_ascii} non-ASCII bytes)")

sys.exit(1 if failed else 0)
