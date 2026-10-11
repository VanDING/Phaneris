#!/usr/bin/env python3
"""Compare the recorded runtime/governance source inputs with a local repository."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

archive = Path(__file__).resolve().parent
repository = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else archive.parents[3]
snapshot = json.loads((archive / 'analysis/source-snapshot.json').read_text())
head = subprocess.check_output(['git', '-C', str(repository), 'rev-parse', 'HEAD'], text=True).strip()
assert head == snapshot['headSha'], 'Repository HEAD differs from the recorded baseline'
for item in snapshot['changedFiles']:
    path = PurePosixPath(item['path'])
    assert not path.is_absolute() and '..' not in path.parts
    actual = repository.joinpath(*path.parts)
    if item['sha256'] is None:
        assert not actual.exists(), f'Recorded deleted source exists: {path}'
    else:
        assert actual.is_file(), f'Missing recorded source: {path}'
        assert hashlib.sha256(actual.read_bytes()).hexdigest() == item['sha256'], f'Source changed: {path}'
print(json.dumps({'headSha': head, 'verifiedSourceInputs': len(snapshot['changedFiles'])}))
