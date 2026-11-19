"""FM-16 local-library fixtures: tiny temporary labelled files + isolated SQLite.

No owner library is touched, no real audio is decoded (the scanner only reads
bytes for bounded fingerprints), and no Linux cloud path is claimed playable
on the owner's Windows Desktop — actual host media-protocol/range behavior and
real audio remain explicit FM-25 owner-review gates.
"""

from __future__ import annotations

import hashlib
import importlib
import sys
import types
from pathlib import Path

import pytest


@pytest.fixture
def lib(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    hermes_constants = types.ModuleType("hermes_constants")
    hermes_constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", hermes_constants)
    sys.modules.pop("dashboard.local_library", None)
    module = importlib.import_module("dashboard.local_library")
    yield module
    sys.modules.pop("dashboard.local_library", None)


def write_track(path: Path, payload: bytes = b"ID3-labelled-fixture-audio") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def make_library(lib, tmp_path: Path):
    return lib.LocalLibrary(tmp_path / "state" / "library.sqlite3")


def test_missing_tracks_stay_listed_and_restore_with_the_same_id(lib, tmp_path: Path):
    music = tmp_path / "Music"
    track = write_track(music / "Song.mp3")
    library = make_library(lib, tmp_path)
    added = library.add_root(str(music))
    track_id = library.list_tracks()["items"][0]["id"]
    assert added["scan"] == {"roots_scanned": 1, "available_tracks": 1, "missing_tracks": 0, "errors": []}
    track.unlink()
    scan = library.scan()
    assert scan["available_tracks"] == 0 and scan["missing_tracks"] == 1
    rows = library.list_tracks()["items"]
    assert len(rows) == 1 and rows[0]["id"] == track_id and rows[0]["available"] is False, "missing rows are retained, not deleted"
    assert library.get_track(track_id)["available"] is False
    write_track(track)
    restored = library.scan()
    assert restored["available_tracks"] == 1 and restored["missing_tracks"] == 0
    row = library.list_tracks()["items"][0]
    assert row["id"] == track_id and row["available"] is True, "restoring the file relinks the exact same identity"


def test_ambiguous_fingerprint_never_relinks(lib, tmp_path: Path):
    music = tmp_path / "Music"
    same_bytes = b"ID3-identical-content"
    write_track(music / "A.mp3", same_bytes)
    write_track(music / "B.mp3", same_bytes)
    library = make_library(lib, tmp_path)
    library.add_root(str(music))
    original_ids = {row["title"]: row["id"] for row in library.list_tracks()["items"]}
    (music / "A.mp3").unlink()
    (music / "B.mp3").unlink()
    write_track(music / "C.mp3", same_bytes)
    library.scan()
    rows = {row["title"]: row for row in library.list_tracks()["items"]}
    assert rows["C"]["available"] is True
    assert rows["C"]["id"] not in set(original_ids.values()), "two missing candidates make the relink ambiguous: a new identity is created"
    assert rows["A"]["available"] is False and rows["B"]["available"] is False
    assert rows["A"]["id"] == original_ids["A"] and rows["B"]["id"] == original_ids["B"]


def test_removing_a_root_never_deletes_audio(lib, tmp_path: Path):
    music = tmp_path / "Music"
    track = write_track(music / "Keep.mp3")
    library = make_library(lib, tmp_path)
    added = library.add_root(str(music))
    root_id = added["root"]["id"]
    track_id = library.list_tracks()["items"][0]["id"]
    assert library.remove_root(root_id) is True
    assert track.read_bytes() == b"ID3-labelled-fixture-audio", "removing an index root is not deleting audio files"
    assert library.list_tracks()["total"] == 0, "index rows cascade away with the root"
    with pytest.raises(ValueError, match="local track was not found"):
        library.get_track(track_id)
    readded = library.add_root(str(music))
    assert readded["root"]["id"] == root_id
    assert library.list_tracks()["items"][0]["id"] == track_id, "re-approval rebuilds the same stable identities"


def test_symlinked_directories_and_files_are_not_indexed(lib, tmp_path: Path):
    music = tmp_path / "Music"
    outside = tmp_path / "Outside"
    write_track(music / "Real.mp3")
    write_track(outside / "Secret.mp3")
    (music / "linked-dir").symlink_to(outside, target_is_directory=True)
    (music / "linked-file.mp3").symlink_to(outside / "Secret.mp3")
    library = make_library(lib, tmp_path)
    library.add_root(str(music))
    titles = [row["title"] for row in library.list_tracks()["items"]]
    assert titles == ["Real"], "no directory-symlink following and no symlinked audio files"


def test_extension_allowlist_root_confinement_and_root_validation(lib, tmp_path: Path):
    music = tmp_path / "Music"
    write_track(music / "Song.mp3")
    write_track(music / "Song2.flac")
    write_track(music / "notes.txt", b"text")
    write_track(music / "cover.jpg", b"image")
    write_track(tmp_path / "Sibling" / "Other.mp3")
    library = make_library(lib, tmp_path)
    library.add_root(str(music))
    titles = sorted(row["title"] for row in library.list_tracks()["items"])
    assert titles == ["Song", "Song2"], "only supported audio extensions inside the approved root"
    with pytest.raises(ValueError, match="absolute"):
        library.add_root("relative/path")
    with pytest.raises(ValueError, match="does not exist"):
        library.add_root(str(tmp_path / "Missing"))
    with pytest.raises(ValueError, match="path is invalid"):
        library.add_root(str(music) + "\x00")
    file_root = library.add_root(str(music / "Song.mp3"))
    assert file_root["root"]["path"] == str(music), "a file path approves its parent folder, never a broader root"


def test_read_time_availability_without_rescan(lib, tmp_path: Path):
    music = tmp_path / "Music"
    track = write_track(music / "Gone.mp3")
    library = make_library(lib, tmp_path)
    library.add_root(str(music))
    track_id = library.list_tracks()["items"][0]["id"]
    track.unlink()
    assert library.get_track(track_id)["available"] is False, "reads recheck the filesystem without waiting for a rescan"
    assert library.list_tracks()["items"][0]["available"] is False


def test_scan_limit_is_bounded_and_rolls_back(lib, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    music = tmp_path / "Music"
    for name in ("One.mp3", "Two.mp3", "Three.mp3"):
        write_track(music / name)
    monkeypatch.setattr(lib, "_MAX_TRACKS_PER_SCAN", 2)
    library = make_library(lib, tmp_path)
    added = library.add_root(str(music))
    assert added["scan"]["roots_scanned"] == 0
    assert len(added["scan"]["errors"]) == 1 and "safety limit" in added["scan"]["errors"][0]["error"]
    assert library.list_tracks()["total"] == 0, "an over-limit scan rolls back instead of indexing a partial library"


def test_fingerprint_is_bounded_head_and_tail(lib, tmp_path: Path):
    music = tmp_path / "Music"
    chunk = lib._FINGERPRINT_CHUNK_BYTES
    head = b"A" * chunk
    tail = b"B" * chunk
    middle = b"M" * (200_000 - 2 * chunk)
    first = write_track(music / "First.mp3", head + middle + tail)
    second = write_track(music / "Second.mp3", head + b"X" * len(middle) + tail)
    size = first.stat().st_size
    expected = hashlib.sha256(str(size).encode("ascii") + head + tail).hexdigest()
    assert lib._fingerprint(first, size) == expected, "only size + first/last 64KB are read, never the whole file"
    assert lib._fingerprint(second, size) == expected, "bounded fingerprint is content-head/tail identity, not a full hash"
    library = make_library(lib, tmp_path)
    library.add_root(str(music))
    ids = {row["title"]: row["id"] for row in library.list_tracks()["items"]}
    assert ids["First"] != ids["Second"], "distinct paths keep distinct stable ids even with equal bounded fingerprints"
