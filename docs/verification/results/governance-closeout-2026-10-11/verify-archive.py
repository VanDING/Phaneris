#!/usr/bin/env python3
"""Verify a curated evidence archive using only Python's standard library."""
import hashlib
import json
from pathlib import Path, PurePosixPath


def verify(root: Path) -> dict:
    def file(name: str) -> Path:
        parts = PurePosixPath(name)
        assert not parts.is_absolute() and '..' not in parts.parts, f'Unsafe archive path: {name}'
        path = root.joinpath(*parts.parts)
        assert path.is_file() and not path.is_symlink(), f'Missing archive file: {name}'
        assert path.resolve().is_relative_to(root.resolve()), f'Escaping archive path: {name}'
        return path

    def sha(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    listed = {}
    for line in file('SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        assert len(digest) == 64 and name not in listed, f'Invalid/duplicate hash entry: {name}'
        assert sha(file(name)) == digest, f'Archive SHA mismatch: {name}'
        listed[name] = digest
    actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name != 'SHA256SUMS'}
    assert set(listed) == actual, f'Archive file inventory mismatch: {set(listed) ^ actual}'
    selection = json.loads(file('selection-manifest.json').read_text())
    retained = omitted = 0
    directories = set()
    for row in selection['runs']:
        directory = row['archiveDirectory']
        assert directory not in directories, f'Duplicate source run: {directory}'
        directories.add(directory)
        manifest_path = file(f'{directory}/manifest.json')
        assert sha(manifest_path) == row['originalManifestSha256'], f'Original manifest changed: {directory}'
        manifest = json.loads(manifest_path.read_text())
        assert manifest['exitCode'] == row['exitCode'] and manifest['passed'] == row['passed'], directory
        assert manifest['passed'] == len(manifest['sceneIds']) == len(set(manifest['sceneIds'])), directory
        assert manifest['exitCode'] != 0 or manifest['passed'] > 0, f'Empty positive run: {directory}'
        artifacts = {item['path']: item for item in manifest['artifacts']}
        assert len(artifacts) == len(manifest['artifacts']), f'Duplicate original artifact: {directory}'
        selected = set()
        for item in row['retained']:
            source = item['source']
            assert source in artifacts and source not in selected, f'Invalid retained artifact: {directory}/{source}'
            selected.add(source)
            assert item['archive'] == f'{directory}/{source}', item['archive']
            path = file(item['archive'])
            assert sha(path) == item['sha256'] == artifacts[source]['sha256'], item['archive']
            assert path.stat().st_size == artifacts[source]['bytes'], item['archive']
            retained += 1
        excluded = set()
        for item in row['omitted']:
            assert item['path'] in artifacts and item['path'] not in excluded and item['reason'].strip(), item
            excluded.add(item['path'])
            omitted += 1
        assert not selected & excluded and selected | excluded == set(artifacts), f'Incomplete selection: {directory}'
    for item in selection['directInputs']:
        assert sha(file(item['archive'])) == item['sha256'], item['archive']
    return {'verifiedFiles': len(listed), 'sourceRuns': len(directories), 'retainedArtifacts': retained,
            'explicitlyOmittedArtifacts': omitted, 'directInputs': len(selection['directInputs'])}


if __name__ == '__main__':
    print(json.dumps(verify(Path(__file__).resolve().parent), sort_keys=True))
