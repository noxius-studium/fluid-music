"""Create the installable, directory-preserving FluidMusic release archive."""

from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "fluid-music"
FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
REQUIRED_PATHS = (
    Path("plugin.yaml"),
    Path("__init__.py"),
    Path("pyproject.toml"),
    Path("dashboard/__init__.py"),
    Path("dashboard/manifest.json"),
    Path("dashboard/plugin_api.py"),
    Path("dashboard/local_library.py"),
    Path("desktop/plugin.js"),
    Path("desktop/src/00-runtime.js"),
    Path("desktop/src/10-model.js"),
    Path("desktop/src/20-styles.js"),
    Path("desktop/src/30-controller.js"),
    Path("desktop/src/40-ui.js"),
    Path("desktop/src/41-library.js"),
    Path("desktop/src/42-playlists.js"),
    Path("desktop/src/43-visualizer.js"),
    Path("desktop/src/44-workspace.js"),
    Path("scripts/build_desktop.py"),
    Path("README.md"),
    Path("LICENSE"),
)


def plugin_version(plugin_yaml: Path) -> str:
    """Read the simple top-level version field without adding a YAML build dependency."""
    for line in plugin_yaml.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"version:\s*['\"]?([^'\"\s#]+)['\"]?\s*(?:#.*)?", line)
        if match:
            return match.group(1)
    raise ValueError(f"No version found in {plugin_yaml}")


def release_files(root: Path) -> list[Path]:
    """Return the complete release contract in stable archive order."""
    missing = [path for path in REQUIRED_PATHS if not (root / path).is_file()]
    if missing:
        names = ", ".join(path.as_posix() for path in missing)
        raise FileNotFoundError(f"Required release file(s) missing: {names}")
    docs = root / "docs"
    if not docs.is_dir():
        raise FileNotFoundError("Required release directory missing: docs")
    files = list(REQUIRED_PATHS)
    files.extend(path.relative_to(root) for path in sorted(docs.rglob("*")) if path.is_file())
    return sorted(files, key=lambda path: path.as_posix())


def write_archive(root: Path, output: Path) -> Path:
    """Write a deterministic zip containing one installable ``fluid-music/`` directory."""
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in release_files(root):
            info = zipfile.ZipInfo(f"{ARCHIVE_ROOT}/{path.as_posix()}", FIXED_ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (root / path).read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Archive path (defaults to dist/fluid-music-<version>.zip)")
    args = parser.parse_args()
    version = plugin_version(ROOT / "plugin.yaml")
    output = args.output or ROOT / "dist" / f"fluid-music-{version}.zip"
    print(write_archive(ROOT, output).resolve())


if __name__ == "__main__":
    main()
