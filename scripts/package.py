"""Create the installable, directory-preserving FluidMusic release archive.

The archive is deterministic (fixed timestamps, stable order) and carries a
generated BUILD-INFO.json binding the product version to the source commit
and per-file SHA256 hashes. Internal handoff machinery, secrets, real
databases, history, media and caches are never release content.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
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
    Path("dashboard/providers/__init__.py"),
    Path("dashboard/providers/token_store.py"),
    Path("dashboard/providers/spotify.py"),
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
# Owner-facing documentation only. The agent-plan kanban cards, import
# machinery, local payloads and execution policy are internal provenance and
# are deliberately NOT release content.
DOCS_ALLOWLIST = (
    "docs/architecture.md",
    "docs/limitations.md",
    "docs/spotify-setup.md",
    "docs/handoffs/agent-plan/COMPATIBILITY.md",
)
FORBIDDEN_PARTS = (".env", ".sqlite", ".db", ".pem", ".key", ".p12", ".pfx", "__pycache__", "node_modules", ".git", "plugin-data")
FORBIDDEN_SUFFIXES = (".mp3", ".flac", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".webm", ".png", ".jpg", ".jpeg", ".zip")
SECRET_JSON = re.compile(r"(^|/)(oauth-)?token[^/]*\.json$|(^|/)credentials?[^/]*\.json$|(^|/)secrets?[^/]*\.json$")


def plugin_version(plugin_yaml: Path) -> str:
    """Read the simple top-level version field without adding a YAML build dependency."""
    for line in plugin_yaml.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"version:\s*['\"]?([^'\"\s#]+)['\"]?\s*(?:#.*)?", line)
        if match:
            return match.group(1)
    raise ValueError(f"No version found in {plugin_yaml}")


def is_forbidden_release_path(path: Path) -> bool:
    """Secret DATA, real databases, media and caches are never release content.

    Source modules such as providers/token_store.py are code, not secrets, and
    remain required release content.
    """
    lowered = path.as_posix().lower()
    if any(part in lowered for part in FORBIDDEN_PARTS):
        return True
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        return True
    return bool(SECRET_JSON.search(lowered))


def release_files(root: Path) -> list[Path]:
    """Return the complete release contract in stable archive order."""
    missing = [path for path in REQUIRED_PATHS if not (root / path).is_file()]
    if missing:
        names = ", ".join(path.as_posix() for path in missing)
        raise FileNotFoundError(f"Required release file(s) missing: {names}")
    files = list(REQUIRED_PATHS)
    docs = root / "docs"
    if not docs.is_dir():
        raise FileNotFoundError("Required release directory missing: docs")
    for relative in DOCS_ALLOWLIST:
        candidate = root / relative
        if candidate.is_file():
            files.append(Path(relative))
    receipts = docs / "handoffs" / "agent-plan" / "receipts"
    if receipts.is_dir():
        files.extend(path.relative_to(root) for path in sorted(receipts.glob("*.md")) if path.is_file())
    files.extend(path.relative_to(root) for path in sorted(docs.glob("release-*.md")) if path.is_file())
    for path in files:
        if is_forbidden_release_path(path):
            raise ValueError(f"Forbidden release content: {path.as_posix()}")
    return sorted(set(files), key=lambda path: path.as_posix())


def source_binding(root: Path) -> dict[str, str]:
    """Bind the artifact to the exact source commit when git provenance exists."""
    def git(*args: str) -> str:
        try:
            return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True, timeout=30).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return "unknown"
    return {"source_sha": git("rev-parse", "HEAD"), "branch": git("rev-parse", "--abbrev-ref", "HEAD")}


def write_archive(root: Path, output: Path) -> Path:
    """Write a deterministic zip containing one installable ``fluid-music/`` directory."""
    output.parent.mkdir(parents=True, exist_ok=True)
    files = release_files(root)
    hashes = {path.as_posix(): hashlib.sha256((root / path).read_bytes()).hexdigest() for path in files}
    build_info = {
        "name": "fluid-music",
        "version": plugin_version(root / "plugin.yaml"),
        **source_binding(root),
        "file_sha256": hashes,
    }
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        info = zipfile.ZipInfo(f"{ARCHIVE_ROOT}/BUILD-INFO.json", FIXED_ZIP_TIMESTAMP)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, json.dumps(build_info, indent=2, sort_keys=True) + "\n", compress_type=zipfile.ZIP_DEFLATED)
        for path in files:
            info = zipfile.ZipInfo(f"{ARCHIVE_ROOT}/{path.as_posix()}", FIXED_ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (root / path).read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_name(output.name + ".sha256").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Archive path (defaults to dist/fluid-music-<version>.zip)")
    args = parser.parse_args()
    version = plugin_version(ROOT / "plugin.yaml")
    output = args.output or ROOT / "dist" / f"fluid-music-{version}.zip"
    result = write_archive(ROOT, output)
    digest = hashlib.sha256(result.read_bytes()).hexdigest()
    print(result.resolve())
    print(f"sha256 {digest}")


if __name__ == "__main__":
    main()
