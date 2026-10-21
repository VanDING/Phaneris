"""Actual CLI tasks; outputs and raw command evidence remain in the run directory."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
import time
from pathlib import Path

root, output = (Path(value).resolve() for value in sys.argv[1:3])
sys.path.insert(0, str(root))
from apps.electron.resources.scripts.tests._tool_test_harness import (  # noqa: E402
    SCRIPTS_DIR, build_env, resolve_uv_invocation, resolve_wrapper, run_tool,
)

env = build_env()
env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
commands: list[dict] = []
scenes: list[str] = []


def call(tool: str, *arguments: str) -> str:
    invocation = resolve_uv_invocation(tool)
    wrapper = resolve_wrapper(tool)
    if invocation:
        python_version, script = invocation
        argv = [str(env["PHANERIS_UV"]), "run", "--python", python_version, str(script), *arguments]
    else:
        # POSIX uses the real shell wrapper; only Windows bypasses cmd.exe to
        # preserve literal newlines, exactly as the existing tool harness does.
        match = re.search(r'--python\s+(\S+)\s+"\$PHANERIS_SCRIPTS/([A-Za-z0-9_]+\.py)"', wrapper.read_text(encoding="utf-8"))
        assert match, tool
        python_version, script = match.group(1), SCRIPTS_DIR / match.group(2)
        argv = [str(wrapper), *arguments]
    assert python_version == "3.12.15", tool
    started = time.monotonic()
    result = run_tool(tool, *arguments, env=env)
    record = dict(tool=tool, argv=argv,
                  exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr,
                  elapsedMs=round((time.monotonic() - started) * 1000),
                  scriptSha256=hashlib.sha256(script.read_bytes()).hexdigest(),
                  wrapperSha256=hashlib.sha256(wrapper.read_bytes()).hexdigest())
    commands.append(record)
    (output / "commands.json").write_text(json.dumps(commands, ensure_ascii=False, indent=2), encoding="utf-8")
    assert result.returncode == 0, record
    return result.stdout


try:
    document = output / "report.docx"
    call("docx-tool", "create", "--text", "# Closeout\n\nDOCX_MARKER **bold**", "-o", str(document))
    assert "DOCX_MARKER" in call("docx-tool", "extract", str(document))
    scenes.append("DOC-01-docx-create-extract")

    workbook = output / "scores.xlsx"
    for cell, value in [("A1", "name"), ("B1", "score"), ("A2", "Ada")]:
        call("xlsx-tool", "write", str(workbook), "--cell", cell, "--value", value)
    call("xlsx-tool", "write", str(workbook), "--cell", "B2", "--value", "42", "--type", "number")
    assert json.loads(call("xlsx-tool", "read", str(workbook), "--format", "json")) == [{"name": "Ada", "score": 42}]
    csv = output / "scores.csv"
    call("xlsx-tool", "export", str(workbook), "--format", "csv", "-o", str(csv))
    assert "Ada,42" in csv.read_text(encoding="utf-8-sig")
    scenes.append("DOC-02-xlsx-write-read-export")

    deck = output / "slides.pptx"
    call("pptx-tool", "create", "--title", "Closeout", "--text", "# One\nPPTX_MARKER\n---\n# Two\nSecond slide", "-o", str(deck))
    assert json.loads(call("pptx-tool", "info", str(deck)))["slide_count"] >= 2
    assert "PPTX_MARKER" in call("pptx-tool", "extract", str(deck))
    scenes.append("DOC-03-pptx-create-extract")

    pixel = output / "pixel.png"
    pixel.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n2WQAAAAASUVORK5CYII="))
    resized, jpeg = output / "resized.png", output / "converted.jpg"
    call("img-tool", "resize", str(pixel), "--width", "200", "--height", "200", "-o", str(resized))
    call("img-tool", "convert", str(resized), "--format", "jpg", "-o", str(jpeg))
    image = json.loads(call("img-tool", "info", str(jpeg)))
    assert image["format"] == "JPEG" and image["width"] == image["height"] == 200
    assert jpeg.read_bytes().startswith(b"\xff\xd8\xff")
    scenes.append("DOC-04-image-resize-convert-read")

    pdf = output / "image.pdf"
    call("pdf-tool", "from-image", str(jpeg), "-o", str(pdf))
    assert json.loads(call("pdf-tool", "info", str(pdf)))["pages"] == 1
    assert pdf.read_bytes().startswith(b"%PDF-")
    scenes.append("DOC-05-pdf-create-inspect")

    calendar = output / "planning.ics"
    data = json.dumps([dict(summary="ICAL_MARKER", start="2026-10-20T10:00:00", end="2026-10-20T11:00:00", location="Shanghai")])
    call("ical-tool", "create", "--data", data, "--cal-name", "Closeout", "-o", str(calendar))
    events = json.loads(call("ical-tool", "read", str(calendar), "--format", "json"))
    assert events["event_count"] == 1 and events["events"][0]["summary"] == "ICAL_MARKER"
    scenes.append("DOC-06-ical-create-read")

    before, after = output / "before.txt", output / "after.txt"
    before.write_text("hello\nworld\n", encoding="utf-8")
    after.write_text("hello\nPhaneris\n", encoding="utf-8")
    difference = call("doc-diff", str(before), str(after), "--format", "summary")
    assert "Comparison:" in difference and "Similarity:" in difference
    (output / "difference.txt").write_text(difference, encoding="utf-8")
    scenes.append("DOC-07-document-difference")

    markdown = call("markitdown", str(document))
    assert "DOCX_MARKER" in markdown
    (output / "converted.md").write_text(markdown, encoding="utf-8")
    scenes.append("DOC-08-markitdown-document-conversion")
finally:
    files = {str(file.relative_to(output)): dict(bytes=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest())
             for file in output.iterdir() if file.is_file()}
    (output / "document-tools.json").write_text(json.dumps(dict(scenes=scenes, commands=len(commands), artifacts=files), indent=2), encoding="utf-8")

assert len(scenes) == 8 and all(value["bytes"] > 0 for value in files.values())
print(json.dumps(dict(scenes=scenes, commands=len(commands))))
