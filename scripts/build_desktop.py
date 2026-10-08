"""Build the single-file desktop runtime from maintainable source fragments.

Hermes loads disk desktop plugins through a blob URL, so browser-relative imports
cannot resolve at runtime.  The source is therefore split for humans and joined
byte-for-byte into ``desktop/plugin.js`` for installation.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "desktop" / "plugin.js"
SOURCE_DIR = ROOT / "desktop" / "src"
PARTS = (
    "00-runtime.js",
    "10-model.js",
    "20-styles.js",
    "30-controller.js",
    "40-ui.js",
    "41-library.js",
    "42-playlists.js",
    "43-visualizer.js",
    "44-workspace.js",
)


def source_text() -> str:
    return "".join((SOURCE_DIR / name).read_text(encoding="utf-8") for name in PARTS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if plugin.js is stale")

    args = parser.parse_args()

    built = source_text()
    if args.check:
        current = ENTRY.read_text(encoding="utf-8")
        if current != built:
            print("desktop/plugin.js is stale; run: python scripts/build_desktop.py", file=sys.stderr)
            return 1
        return 0

    ENTRY.write_text(built, encoding="utf-8", newline="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
