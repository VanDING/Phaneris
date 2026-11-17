"""Read-only production inventory; write only an isolated consistent context copy.

Usage: python scripts/verification/resident-work-continuity-production-audit.py WORKSPACE OUTPUT
OUTPUT must be outside WORKSPACE. No raw transcript text is included in the report.
"""
import hashlib
import json
import pathlib
import sqlite3
import sys
from datetime import datetime, timezone

source, output = (pathlib.Path(arg).resolve() for arg in sys.argv[1:3])
if output == source or output.is_relative_to(source):
    raise ValueError("Audit output must be outside the production workspace")
output.mkdir(parents=True, exist_ok=False)


def read_only(path):
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")
    return connection


report = {"observedAt": datetime.now(timezone.utc).isoformat(), "readOnlySource": str(source)}
with read_only(source / "context.db") as original:
    report["contextSchema"] = original.execute("PRAGMA user_version").fetchone()[0]
    tables = {row[0] for row in original.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    report["contextCounts"] = {table: original.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                               for table in ["pointers", "branches", "views", "context_commands", "context_tool_receipts", "work_admissions"] if table in tables}
    columns = {row[1] for row in original.execute("PRAGMA table_info(context_commands)")}
    report["readyPreparations"] = original.execute("SELECT COUNT(*) FROM context_commands WHERE json_extract(body,'$.state')='ready'").fetchone()[0] if "body" in columns else 0
    with sqlite3.connect(output / "context.db") as isolated:
        original.backup(isolated)
report["contextCopySha256"] = hashlib.sha256((output / "context.db").read_bytes()).hexdigest()
with read_only(source / "runtime/runtime.db") as runtime:
    report["unsettledByModeAndStatus"] = [dict(zip(["mode", "status", "count"], row)) for row in runtime.execute(
        "SELECT recovery_mode,status,COUNT(*) FROM tool_operations WHERE outcome_json IS NULL GROUP BY recovery_mode,status")]
    report["originalOperation"] = [dict(zip(["operationId", "runId", "mode", "status", "hasOutcome"], row)) for row in runtime.execute(
        "SELECT operation_id,run_operation_id,recovery_mode,status,outcome_json IS NOT NULL FROM tool_operations WHERE operation_id=?",
        ("toolop_37330ca9e29d637a2c2030e42998d118",))]
transcript = source / "assistant/sessions/261105-copper-cloud/session.jsonl"
if transcript.exists():
    report["originalTranscript"] = {"bytes": transcript.stat().st_size, "sha256": hashlib.sha256(transcript.read_bytes()).hexdigest()}
(output / "read-only-audit.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps(report, indent=2))
