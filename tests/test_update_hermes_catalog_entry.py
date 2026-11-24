from __future__ import annotations

from pathlib import Path

import pytest

from scripts.update_hermes_catalog_entry import (
    read_catalog_identity,
    update_catalog_entry,
)

ENTRY = """name: fluid-music
repo: https://github.com/noxius-studium/fluid-music
sha: 1111111111111111111111111111111111111111
docs_url: https://github.com/noxius-studium/fluid-music/blob/1111111111111111111111111111111111111111/README.md
version: "0.5.1"
screenshots:
  - https://raw.githubusercontent.com/noxius-studium/fluid-music/1111111111111111111111111111111111111111/docs/images/fluidmusic-workspace.png
known_issues:
  - A limitation remains in version 0.5.1.
"""


def test_update_catalog_entry_repins_every_sha_and_version_reference(tmp_path: Path) -> None:
    entry = tmp_path / "fluid-music.yaml"
    entry.write_text(ENTRY, encoding="utf-8")
    new_sha = "2" * 40

    update_catalog_entry(entry, version="0.5.2", sha=new_sha)

    text = entry.read_text(encoding="utf-8")
    assert "1" * 40 not in text
    assert text.count(new_sha) == 3
    assert "0.5.1" not in text
    assert text.count("0.5.2") == 2


def test_read_catalog_identity_returns_the_pinned_version_and_full_sha(tmp_path: Path) -> None:
    entry = tmp_path / "fluid-music.yaml"
    entry.write_text(ENTRY, encoding="utf-8")

    assert read_catalog_identity(entry) == ("0.5.1", "1" * 40)


@pytest.mark.parametrize(
    ("version", "sha"),
    [("v0.5.2", "2" * 40), ("0.5", "2" * 40), ("0.5.2", "short")],
)
def test_update_catalog_entry_rejects_invalid_identity(
    tmp_path: Path, version: str, sha: str
) -> None:
    entry = tmp_path / "fluid-music.yaml"
    entry.write_text(ENTRY, encoding="utf-8")

    with pytest.raises(ValueError):
        update_catalog_entry(entry, version=version, sha=sha)
