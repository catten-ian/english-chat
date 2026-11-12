"""Fetch only the pinned CC0 source files used by build-harbor-v3.py.

No API key, paid service, subprocess, or background server is involved.
Each file must match the published source manifest before it is retained.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
manifest = json.loads(Path(__file__).with_name('harbor-sources.json').read_text())

def fetch(row):
    target = ROOT / row['file'].replace('\\', '/')
    if not target.resolve().is_relative_to((ROOT / 'game/art/polyhaven').resolve()):
        raise ValueError('Source destination must stay inside game/art/polyhaven')
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == row['sha256']:
        return
    request = urllib.request.Request(row['source'], headers={'User-Agent': 'Bellweather-asset-pipeline/1.0'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError(f"Source integrity mismatch: {row['file']}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, manifest))
    print(f'Verified {len(manifest)} CC0 source files.')
