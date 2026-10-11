#!/usr/bin/env python3
"""Read-only inventory of tracked repository files; no network or workspace data."""
import argparse
import collections
import csv
import hashlib
import json
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--root', default='.')
parser.add_argument('--output-dir', required=True)
args = parser.parse_args()
root = pathlib.Path(args.root).resolve()
out = pathlib.Path(args.output_dir).resolve()
out.mkdir(parents=True, exist_ok=True)
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root).decode().strip()
paths = git('ls-files', '-z').split('\0')
source_ext = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.sh', '.ps1', '.css', '.scss', '.html', '.rs', '.c', '.cpp', '.h', '.nsh', '.cmd'}
test_re = re.compile(r'(^|/)(__tests__|tests|__fixtures__|fixtures)(/|$)|\.(test|spec|isolated)\.|(^|/)test_[^/]+\.py$')
rows, docs, source, tests = [], [], [], []
modules = collections.defaultdict(lambda: collections.Counter())
markers = collections.Counter()
for path in sorted(p for p in paths if p):
    file = root / path
    if not file.is_file():
        continue
    suffix = file.suffix.lower()
    data = file.read_bytes()
    is_source = suffix in source_ext
    text = data.decode('utf-8', errors='replace') if is_source or suffix in {'.md', '.mdx', '.json', '.yml', '.yaml', '.txt'} else ''
    lines = len(text.splitlines()) if text else None
    is_test = is_source and bool(test_re.search(path))
    is_prod = is_source and bool(re.match(r'^(apps|packages)/[^/]+/src/', path)) and not is_test and not path.endswith('.d.ts')
    kind = 'production-src' if is_prod else 'test-or-fixture' if is_test else 'source-tooling-or-resource' if is_source else 'documentation' if suffix in {'.md', '.mdx'} else 'other'
    row = {'path': path, 'bytes': len(data), 'lines': lines, 'kind': kind, 'sha256': hashlib.sha256(data).hexdigest()}
    rows.append(row)
    module = '/'.join(path.split('/')[:2]) if path.startswith(('apps/', 'packages/')) else path.split('/')[0]
    modules[module]['tracked_files'] += 1
    modules[module]['tracked_bytes'] += len(data)
    if is_source:
        modules[module]['source_files'] += 1
        modules[module]['source_lines'] += lines or 0
        source.append(row)
    if is_test:
        modules[module]['test_or_fixture_files'] += 1
        tests.append(row)
    if is_prod:
        modules[module]['production_src_files'] += 1
        modules[module]['production_src_lines'] += lines or 0
        # Lexical markers only: comments and strings are intentionally not filtered.
        for name, pattern in {'todo_fixme': r'\b(?:TODO|FIXME|HACK|XXX)\b', 'ts_ignore': r'@ts-ignore\b', 'ts_nocheck': r'@ts-nocheck\b', 'eslint_disable': r'eslint-disable', 'as_any': r'\bas\s+any\b'}.items():
            markers[name] += len(re.findall(pattern, text))
    if suffix in {'.md', '.mdx'}:
        headings = [{'line': i, 'text': s} for i, s in enumerate(text.splitlines(), 1) if re.match(r'^#{1,4} ', s)]
        statuses = [s for s in text.splitlines()[:25] if re.search(r'(?i)status\s*[:：]|状态\s*[:：]|最后核对|核实于|更新日期|适用范围', s)]
        docs.append({'path': path, 'lines': lines, 'sha256': row['sha256'], 'status_lines': statuses, 'open_checkboxes': len(re.findall(r'^\s*- \[ \]', text, re.M)), 'closed_checkboxes': len(re.findall(r'^\s*- \[[xX]\]', text, re.M)), 'headings': headings})
packages = []
for file in sorted(root.glob('apps/*/package.json')) + sorted(root.glob('packages/*/package.json')):
    pkg = json.loads(file.read_text())
    packages.append({'path': str(file.relative_to(root)), 'name': pkg['name'], 'description': pkg.get('description'), 'scripts': pkg.get('scripts', {}), 'exports': pkg.get('exports', {}), 'dependencies': pkg.get('dependencies', {}), 'devDependencies': pkg.get('devDependencies', {})})
declared_edges = [{'from': p['name'], 'to': n, 'section': section} for p in packages for section in ['dependencies', 'devDependencies'] for n, v in p[section].items() if v.startswith('workspace:')]
prod = [r for r in rows if r['kind'] == 'production-src']
report = {
    'schemaVersion': 1,
    'baseHead': git('rev-parse', 'HEAD'),
    'inputStatus': git('status', '--short'),
    'scope': 'git ls-files, working-tree contents; line counts exclude binaries; production-src includes development playground code in src, excludes tests/fixtures/declarations',
    'limitations': ['File size is an investigation signal, not a defect.', 'Lexical markers include comments/strings and do not identify bugs.', 'Test-file counts describe presence, not coverage.', 'No external advisories, provider calls, or user workspace data were queried.'],
    'corpusSha256': hashlib.sha256('\n'.join(r['path'] + ' ' + r['sha256'] for r in rows).encode()).hexdigest(),
    'summary': {'trackedFiles': len(rows), 'trackedBytes': sum(r['bytes'] for r in rows), 'sourceFiles': len(source), 'sourceLines': sum(r['lines'] or 0 for r in source), 'productionSrcFiles': len(prod), 'productionSrcLines': sum(r['lines'] or 0 for r in prod), 'testOrFixtureFiles': len(tests), 'markdownFiles': len(docs), 'docsMarkdownFiles': sum(d['path'].startswith('docs/') for d in docs), 'workspaceMembers': len(packages), 'declaredWorkspaceEdges': len(declared_edges)},
    'modules': dict(sorted(modules.items())),
    'largestProductionFiles': sorted(prod, key=lambda r: (-r['lines'], r['path']))[:60],
    'largestToolingOrResourceFiles': sorted([r for r in source if r['kind'] == 'source-tooling-or-resource'], key=lambda r: (-r['lines'], r['path']))[:25],
    'lexicalMarkersInProductionSrc': dict(markers),
    'packages': packages,
    'declaredWorkspaceEdges': declared_edges,
    'documents': docs,
}
(out / 'inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
with (out / 'tracked-files.csv').open('w', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=['path', 'bytes', 'lines', 'kind', 'sha256'])
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps(report['summary'], ensure_ascii=False))
for row in report['largestProductionFiles'][:20]:
    print(f"{row['lines']:6} {row['path']}")
