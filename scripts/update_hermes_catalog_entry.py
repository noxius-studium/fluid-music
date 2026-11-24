from __future__ import annotations

import argparse
import re
from pathlib import Path

SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
SHA_LINE = re.compile(r"^sha:\s*([0-9a-f]{40})\s*$", re.MULTILINE)
VERSION_LINE = re.compile(r'^version:\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$', re.MULTILINE)


def read_catalog_identity(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8")
    sha_match = SHA_LINE.search(text)
    version_match = VERSION_LINE.search(text)
    if sha_match is None:
        raise ValueError("catalog entry does not contain one full sha field")
    if version_match is None:
        raise ValueError("catalog entry does not contain one quoted semantic version field")
    return version_match.group(1), sha_match.group(1)


def update_catalog_entry(path: Path, *, version: str, sha: str) -> None:
    if SEMVER.fullmatch(version) is None:
        raise ValueError(f"{version!r} is not a numeric semantic version")
    if FULL_SHA.fullmatch(sha) is None:
        raise ValueError("catalog pin must be a full lowercase 40-character commit SHA")

    text = path.read_text(encoding="utf-8")
    old_version, old_sha = read_catalog_identity(path)
    if old_sha == sha and old_version == version:
        raise ValueError("catalog entry already points at this release")

    updated = text.replace(old_sha, sha).replace(old_version, version)
    if f"sha: {sha}" not in updated or f'version: "{version}"' not in updated:
        raise ValueError("catalog identity replacement was incomplete")
    path.write_text(updated, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-pin the Hermes catalog entry.")
    parser.add_argument("entry", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--sha")
    parser.add_argument("--show-current", action="store_true")
    args = parser.parse_args()

    if args.show_current:
        version, sha = read_catalog_identity(args.entry)
        print(version)
        print(sha)
        return 0
    if args.version is None or args.sha is None:
        parser.error("--version and --sha are required unless --show-current is used")
    update_catalog_entry(args.entry, version=args.version, sha=args.sha)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
