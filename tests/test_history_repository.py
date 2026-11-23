"""Profile-scoped played-history repository fixtures (FM-06).

Labelled cloud fixtures: every database is an isolated temporary SQLite file
created by the test; NO user database is read or written. These prove
persistence, ordering, bounded retention/clear, profile isolation and payload
sanitization only — real Desktop history/playback remains owner acceptance
(FM-25).
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def host_constants(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Labelled host stand-in; every database path in this file is explicit/tmp."""
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)


def load_library_module():
    name = "fm06_local_library_under_test"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, ROOT / "dashboard" / "local_library.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def library(tmp_path: Path):
    module = load_library_module()
    return module.LocalLibrary(tmp_path / "isolated" / "library.sqlite3")


def item(source: str = "youtube", **overrides: Any) -> dict[str, Any]:
    base = {
        "id": "youtube:abcdefghijk",
        "source": source,
        "url": "https://www.youtube.com/watch?v=abcdefghijk",
        "title": "Night set",
        "subtitle": "Night Channel",
        "artwork": "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    }
    if source == "radio":
        base = {"id": "radio:station", "source": "radio", "title": "Station", "streamUrl": "https://radio.example/live"}
    if source == "spotify":
        base = {"id": "spotify:track:one", "source": "spotify", "title": "Track", "uri": "spotify:track:one"}
    if source == "local":
        base = {"id": "local:a", "source": "local", "title": "One", "localTrackId": "a"}
    base.update(overrides)
    return base


def test_history_persists_across_repository_reopen_with_stable_order(library, tmp_path: Path):
    first = library.record_history(item(title="First"))
    library.record_history(item(title="Second"))
    library.record_history(item(title="Third"))
    reopened = type(library)(tmp_path / "isolated" / "library.sqlite3")
    listed = reopened.list_history()
    assert listed["total"] == 3
    assert [entry["item"]["title"] for entry in listed["items"]] == ["Third", "Second", "First"]
    assert listed["items"][2]["id"] == first["id"]
    assert all(entry["played_at"] for entry in listed["items"])


def test_clear_is_bounded_to_history_and_reports_removed_count(library, tmp_path: Path):
    music = tmp_path / "Music"
    music.mkdir()
    (music / "Track.mp3").write_bytes(b"ID3" + b"x" * 128)
    library.add_root(str(music))
    for index in range(5):
        library.record_history(item(title=f"Play {index}"))
    assert library.clear_history() == 5
    assert library.list_history() == {"items": [], "total": 0}
    # Clearing history never touches roots or indexed tracks.
    assert len(library.list_roots()) == 1
    assert library.list_tracks()["total"] == 1


def test_two_profile_roots_do_not_share_history(tmp_path: Path):
    module = load_library_module()
    profile_a = module.LocalLibrary(tmp_path / "profile-a" / "library.sqlite3")
    profile_b = module.LocalLibrary(tmp_path / "profile-b" / "library.sqlite3")
    profile_a.record_history(item(title="Profile A play"))
    assert profile_a.list_history()["total"] == 1
    assert profile_b.list_history() == {"items": [], "total": 0}
    profile_b.record_history(item(title="Profile B play"))
    assert [entry["item"]["title"] for entry in profile_a.list_history()["items"]] == ["Profile A play"]


def test_retention_is_bounded_to_the_newest_5000_records(library):
    for index in range(5_001):
        library.record_history(item(title=f"Play {index}"))
    listed = library.list_history(limit=500)
    assert listed["total"] == 5_000
    assert listed["items"][0]["item"]["title"] == "Play 5000"
    oldest = library.list_history(limit=1, offset=4_999)
    assert oldest["items"][0]["item"]["title"] == "Play 1"


def test_list_queries_are_bounded_and_paginate_stably(library):
    for index in range(5):
        library.record_history(item(title=f"Play {index}"))
    page = library.list_history(limit=999, offset=0)
    assert len(page["items"]) == 5 and page["total"] == 5
    middle = library.list_history(limit=2, offset=2)
    assert [entry["item"]["title"] for entry in middle["items"]] == ["Play 2", "Play 1"]
    assert middle["total"] == 5


def test_payload_sanitization_strips_private_references_and_unsafe_art(library):
    recorded = library.record_history(item(
        objectUrl="blob:https://desktop/secret",
        filePath="C:/Users/owner/Music/private.mp3",
        playbackUrls=["hermes-media://stream/secret"],
        accessToken="must-not-persist",
        capability_url="http://127.0.0.1:9/token/youtube/abcdefghijk",
        artwork="http://insecure.example/a.jpg",
    ))
    stored = recorded["item"]
    for forbidden in ("objectUrl", "filePath", "playbackUrls", "accessToken", "capability_url"):
        assert forbidden not in stored
    assert stored["artwork"] == "", "non-https artwork is dropped"
    assert "must-not-persist" not in json.dumps(stored)
    assert "127.0.0.1" not in json.dumps(stored)


def test_local_history_keeps_only_the_safe_library_reference(library):
    recorded = library.record_history(item("local", filePath="C:/Music/One.mp3", objectUrl="blob:x"))
    stored = recorded["item"]
    assert stored["localTrackId"] == "a"
    assert "filePath" not in stored and "objectUrl" not in stored


@pytest.mark.parametrize("bad", [
    item(url="https://user:pass@www.youtube.com/watch?v=abcdefghijk"),
    item(url="https://evil.example/watch?v=abcdefghijk"),
    item("radio", streamUrl="http://radio.example/live"),
    item("radio", streamUrl="https://user:pass@radio.example/live"),
    item(title=""),
    item(id="", url=""),
])
def test_unsafe_or_identity_less_history_items_are_rejected(library, bad: dict[str, Any]):
    with pytest.raises(ValueError):
        library.record_history(bad)
    assert library.list_history()["total"] == 0


def test_oversized_history_payload_is_rejected(library):
    with pytest.raises(ValueError):
        library.record_history(item(description="x" * 20_000))
