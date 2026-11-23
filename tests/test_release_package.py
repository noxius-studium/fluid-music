"""FM-24 release-package contract fixtures.

Labelled cloud fixtures: archives are built into isolated temporary paths from
the real source tree (read-only). No install, publish, host-runtime change or
real user data is involved. Deterministic bytes, content allowlist, secret
exclusion and BUILD-INFO hash binding are proven here; actual Desktop install
and rendering remain FM-25 owner acceptance.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_package_module():
    name = "fm24_package_under_test"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "package.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def packaging():
    return load_package_module()


def test_release_content_contract(packaging, tmp_path: Path):
    files = packaging.release_files(ROOT)
    names = {path.as_posix() for path in files}
    for required in packaging.REQUIRED_PATHS:
        assert required.as_posix() in names, f"required runtime file {required} is in the release"
    assert "docs/architecture.md" in names and "docs/limitations.md" in names
    assert "docs/handoffs/agent-plan/COMPATIBILITY.md" in names
    assert any(name.startswith("docs/handoffs/agent-plan/receipts/") for name in names), "execution receipts ship as review evidence"
    assert any(name.startswith("docs/release-") for name in names), "release notes ship"
    # Internal handoff machinery and local payloads are NOT release content.
    for forbidden in ("kanban/", "import-receipt", "import_kanban.py", "build_handoff.py", "scope_update.py", "EXECUTION_POLICY.md", "MASTER_PLAN.md", "SOURCES.json"):
        assert not any(forbidden in name for name in names), f"internal machinery {forbidden} excluded"
    for name in names:
        assert not packaging.is_forbidden_release_path(Path(name)), f"forbidden content {name}"
    assert "dashboard/providers/token_store.py" in names, "the token-store CODE module ships; secret data never does"
    backend_sources = {path.relative_to(ROOT).as_posix() for path in (ROOT / "dashboard").rglob("*.py")}
    assert backend_sources <= names, f"every backend module ships: {sorted(backend_sources - names)}"


def test_forbidden_path_guard(packaging):
    for bad in (".env", "oauth-token.json", "secrets.json", "credentials.json", "plugin-data/fluid-music/library.sqlite3", "cache/cover.png", "media/song.mp3", "node_modules/x/index.js", "dist/old.zip"):
        assert packaging.is_forbidden_release_path(Path(bad)), bad
    for good in ("dashboard/providers/token_store.py", "dashboard/manifest.json", "desktop/plugin.js", "docs/architecture.md", "BUILD-INFO.json"):
        assert not packaging.is_forbidden_release_path(Path(good)), good


def test_archive_is_deterministic_and_hash_bound(packaging, tmp_path: Path):
    first = packaging.write_archive(ROOT, tmp_path / "a" / "fluid-music-test.zip")
    second = packaging.write_archive(ROOT, tmp_path / "b" / "fluid-music-test.zip")
    assert first.read_bytes() == second.read_bytes(), "fixed timestamps + stable order give reproducible bytes"
    sidecar = first.with_name(first.name + ".sha256").read_text(encoding="utf-8")
    assert sidecar.split()[0] == hashlib.sha256(first.read_bytes()).hexdigest()
    with zipfile.ZipFile(first) as archive:
        names = archive.namelist()
        assert all(name.startswith("fluid-music/") for name in names), "one installable directory"
        assert "fluid-music/BUILD-INFO.json" in names
        info = json.loads(archive.read("fluid-music/BUILD-INFO.json"))
        assert info["name"] == "fluid-music"
        assert info["version"] == packaging.plugin_version(ROOT / "plugin.yaml")
        assert len(info["source_sha"]) in (7, 40) or info["source_sha"] == "unknown"
        for relative, digest in info["file_sha256"].items():
            member = f"fluid-music/{relative}"
            assert member in names
            assert hashlib.sha256(archive.read(member)).hexdigest() == digest, f"hash binding for {relative}"
        assert len(info["file_sha256"]) == len(names) - 1, "every content file is hash-bound"
        for name in names:
            assert not packaging.is_forbidden_release_path(Path(name.removeprefix("fluid-music/"))), name


def test_version_metadata_is_consistent(packaging):
    yaml_version = packaging.plugin_version(ROOT / "plugin.yaml")
    manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert manifest["version"] == yaml_version
    assert f'version = "{yaml_version}"' in pyproject
    assert yaml_version.startswith("0.5."), "the 0.5.x release line owns this contract"
    version_source = (ROOT / "desktop" / "src" / "01-version.js").read_text(encoding="utf-8")
    assert f"FM_VERSION = '{yaml_version}'" in version_source, "bundle version matches plugin.yaml"
    assert f"FM_VERSION = '{yaml_version}'" in (ROOT / "desktop" / "plugin.js").read_text(encoding="utf-8"), "built bundle carries the same version"


def test_stale_instructions_are_reconciled():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    architecture = (ROOT / "docs" / "architecture.md").read_text(encoding="utf-8")
    limitations = (ROOT / "docs" / "limitations.md").read_text(encoding="utf-8")
    for text in (readme, architecture, limitations):
        assert "fluid-music-youtube" not in text, "owned-Browser handle flow is gone"
        assert "openOrFocus" not in text and "executeJavaScriptIn" not in text, "private preview bridge is gone"
        assert "patched Hermes" not in text, "no private host patch instruction"
    assert "Hermes-managed Spotify PKCE" not in readme and "bundled `SpotifyClient`" not in architecture
    assert "navy" not in architecture and "coral" not in architecture, "private palette description superseded"
    assert "FluidMusic-owned Spotify PKCE" in readme
    assert "capability-protected" in readme and "embed host" in architecture
    assert "playwright install" not in readme and "npm ci" not in readme, "heavy verification steps replaced by the serial suite"
    assert "COMPATIBILITY.md" in readme
