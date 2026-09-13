"""Download the two public cohorts the paper is evaluated on.

Neither is redistributed with this repository: LifeSnaps is CC BY 4.0 but 615 MB,
and both are better fetched from their own archives so the provenance is
unambiguous. Neither requires an application, an approval, or an agreement to
sign.

    python fetch_datasets.py --out data/external

Roughly 2 GB and, on a slow connection, an hour. Resumable: interrupted
downloads continue rather than restart.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.request
import zipfile

SOURCES = {
    "lifesnaps.zip": {
        "url": "https://zenodo.org/records/7229547/files/rais_anonymized.zip?download=1",
        "size": 615_037_493,
        "licence": "CC BY 4.0",
        "cite": "Yfantidou et al., Scientific Data 9:663, 2022",
    },
    "pmdata.zip": {
        "url": "https://datasets.simula.no/downloads/pmdata.zip",
        "size": 1_416_129_266,
        "licence": "see datasets.simula.no/pmdata",
        "cite": "Thambawita et al., MMSys 2020",
    },
}


def _download(url: str, path: str, expected: int) -> None:
    """Fetch with resume, so a dropped connection does not restart 600 MB."""
    done = os.path.getsize(path) if os.path.exists(path) else 0
    if done == expected:
        print(f"    already complete ({done/1e6:.0f} MB)")
        return

    request = urllib.request.Request(url)
    if done:
        request.add_header("Range", f"bytes={done}-")
        print(f"    resuming from {done/1e6:.0f} MB")

    with urllib.request.urlopen(request) as response, open(path, "ab" if done else "wb") as fh:
        while chunk := response.read(1 << 20):
            fh.write(chunk)
            done += len(chunk)
            pct = 100 * done / expected
            sys.stdout.write(f"\r    {done/1e6:7.0f} / {expected/1e6:.0f} MB  ({pct:5.1f}%)")
            sys.stdout.flush()
    print()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.join("data", "external"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for name, meta in SOURCES.items():
        path = os.path.join(args.out, name)
        print(f"[{name}]  {meta['size']/1e6:.0f} MB  ({meta['licence']})")
        print(f"    cite: {meta['cite']}")
        try:
            _download(meta["url"], path, meta["size"])
        except Exception as exc:
            print(f"    FAILED: {exc}")
            print(f"    fetch manually from {meta['url']}")
            continue

        actual = os.path.getsize(path)
        if actual != meta["size"]:
            print(f"    SIZE MISMATCH: {actual} != {meta['size']} - re-run to resume")
            continue
        try:
            zipfile.ZipFile(path).testzip()
            print("    archive verified")
        except zipfile.BadZipFile:
            print("    CORRUPT - delete and re-run")

    print(f"\nPMData must be extracted before use:")
    print(f"    python -c \"import zipfile;zipfile.ZipFile(r'{args.out}/pmdata.zip').extractall(r'{args.out}')\"")
    print(f"\nThen point the pipeline at it:")
    print(f"    set SOMNIAI_DATA_DIR={os.path.abspath(args.out)}      (Windows)")
    print(f"    export SOMNIAI_DATA_DIR={os.path.abspath(args.out)}   (macOS/Linux)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
