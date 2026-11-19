"""FM-22 data-safe migration/backup/rollback/busy fixtures.

Labelled cloud fixtures: every database is an isolated temporary SQLite file
created by the test; NO user database, media or credential is read or written.
These prove versioned migration, raw legacy preservation, bounded backups,
rollback on failure and bounded busy retry — real Desktop restart/packaged-host
behavior remains FM-25 acceptance.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import types
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def host_constants(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)


def load_library_module():
    name = "fm22_local_library_under_test"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, ROOT / "dashboard" / "local_library.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def module():
    return load_library_module()


RAW_PAYLOAD = json.dumps({
    "source": "radio", "id": "radio:old", "streamUrl": "https://radio.example/old",
    "title": "Old", "customFuture": {"keep": True, "nested": [1, 2, 3]},
})


def make_legacy_db(db_path: Path) -> None:
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE playback_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_key TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '', artwork TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL, played_at TEXT NOT NULL
        );
        CREATE TABLE scan_roots (
            id TEXT PRIMARY KEY, path TEXT NOT NULL, canonical_key TEXT NOT NULL UNIQUE,
            added_at TEXT NOT NULL, last_scanned_at TEXT, last_scan_count INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    connection.execute(
        "INSERT INTO playback_history(media_key, source, title, payload_json, played_at) VALUES (?,?,?,?,?)",
        ("radio:old", "radio", "Old", RAW_PAYLOAD, "2026-01-01T00:00:00+00:00"),
    )
    connection.execute(
        "INSERT INTO scan_roots(id, path, canonical_key, added_at) VALUES (?,?,?,?)",
        ("root-1", "C:/Music", "c:/music", "2026-01-01T00:00:00+00:00"),
    )
    connection.commit()
    connection.close()


def version_of(db_path: Path) -> int:
    connection = sqlite3.connect(db_path)
    try:
        return int(connection.execute("PRAGMA user_version").fetchone()[0])
    finally:
        connection.close()


def test_fresh_database_reaches_target_version_with_all_tables(module: Any, tmp_path: Path):
    db = tmp_path / "fresh.sqlite3"
    library = module.LocalLibrary(db)
    library.record_history({"source": "radio", "id": "radio:j", "streamUrl": "https://radio.example/j", "title": "J"})
    assert version_of(db) == module._TARGET_USER_VERSION
    connection = sqlite3.connect(db)
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    connection.close()
    assert {"scan_roots", "local_tracks", "playback_history", "resume_positions", "bookmarks", "plugin_settings"} <= tables
    assert list(tmp_path.glob("fresh.sqlite3.backup-*")) == [], "a brand-new empty database needs no backup"


def test_legacy_migration_preserves_raw_rows_and_backs_up_first(module: Any, tmp_path: Path):
    db = tmp_path / "legacy.sqlite3"
    make_legacy_db(db)
    assert version_of(db) == 0
    library = module.LocalLibrary(db)
    library.list_history()
    assert version_of(db) == module._TARGET_USER_VERSION
    connection = sqlite3.connect(db)
    row = connection.execute("SELECT payload_json FROM playback_history WHERE media_key='radio:old'").fetchone()
    roots = connection.execute("SELECT COUNT(*) FROM scan_roots").fetchone()[0]
    connection.close()
    assert row[0] == RAW_PAYLOAD, "raw legacy payload survives byte-for-byte"
    assert roots == 1, "legacy roots are preserved"
    assert library.list_history()["items"][0]["item"]["customFuture"] == {"keep": True, "nested": [1, 2, 3]}
    backups = list(tmp_path.glob("legacy.sqlite3.backup-v0-*"))
    assert len(backups) == 1, "exactly one pre-migration backup"
    backup_connection = sqlite3.connect(backups[0])
    backup_tables = {row[0] for row in backup_connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    backup_payload = backup_connection.execute("SELECT payload_json FROM playback_history").fetchone()[0]
    backup_connection.close()
    assert "resume_positions" not in backup_tables, "the backup is the PRE-migration state"
    assert backup_payload == RAW_PAYLOAD
    # New structures are usable after migration.
    assert library.save_resume("youtube:abcdefgh001", 60000, 3600000)["position_ms"] == 60000


def test_backups_are_bounded(module: Any, tmp_path: Path):
    db = tmp_path / "bounded.sqlite3"
    make_legacy_db(db)
    for cycle in range(4):
        connection = sqlite3.connect(db)
        connection.execute("PRAGMA user_version = 0")
        connection.commit()
        connection.close()
        module._INITIALIZED_DATABASES.clear()
        module.LocalLibrary(db).list_history()
    backups = list(tmp_path.glob("bounded.sqlite3.backup-*"))
    assert len(backups) <= module._MAX_BACKUPS, "old backups are pruned, never unbounded"


def test_failed_migration_rolls_back_without_data_loss(module: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db = tmp_path / "fail.sqlite3"
    make_legacy_db(db)
    monkeypatch.setattr(module, "_SCHEMA_SQL", "THIS IS NOT VALID SQL;")
    module._INITIALIZED_DATABASES.clear()
    with pytest.raises(sqlite3.Error):
        module.LocalLibrary(db).list_history()
    assert version_of(db) == 0, "version is not bumped on failure"
    connection = sqlite3.connect(db)
    payload = connection.execute("SELECT payload_json FROM playback_history").fetchone()[0]
    roots = connection.execute("SELECT COUNT(*) FROM scan_roots").fetchone()[0]
    connection.close()
    assert payload == RAW_PAYLOAD and roots == 1, "rollback restores the exact pre-migration data"
    assert list(tmp_path.glob("fail.sqlite3.backup-v0-*")), "the backup used for rollback exists"
    # Retry with the real schema succeeds — recovery is possible, not a dead end.
    monkeypatch.undo()
    module._INITIALIZED_DATABASES.clear()
    library = module.LocalLibrary(db)
    assert library.list_history()["total"] == 1
    assert version_of(db) == module._TARGET_USER_VERSION


def test_busy_database_retries_are_bounded_and_lossless(module: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db = tmp_path / "busy.sqlite3"
    library = module.LocalLibrary(db)
    library.record_history({"source": "radio", "id": "radio:warm", "streamUrl": "https://radio.example/warm", "title": "Warm"})
    real_connect = sqlite3.connect
    monkeypatch.setattr(module.sqlite3, "connect", lambda *args, **kwargs: real_connect(*args, **{**kwargs, "timeout": 0.05}))
    sleeps: list[float] = []
    monkeypatch.setattr(module.time, "sleep", lambda seconds: sleeps.append(seconds))
    lock = real_connect(db, timeout=5)
    lock.execute("BEGIN EXCLUSIVE")
    try:
        with pytest.raises(sqlite3.OperationalError):
            library.record_history({"source": "radio", "id": "radio:locked", "streamUrl": "https://radio.example/locked", "title": "Locked"})
        assert len(sleeps) == module._BUSY_RETRIES, "exactly the bounded number of busy retries"
        assert all(delay == module._BUSY_DELAY_S for delay in sleeps)
    finally:
        lock.rollback()
        lock.close()
    entry = library.record_history({"source": "radio", "id": "radio:after", "streamUrl": "https://radio.example/after", "title": "After"})
    assert entry["id"] > 0
    titles = [row["item"]["title"] for row in library.list_history()["items"]]
    assert "Warm" in titles and "After" in titles and "Locked" not in titles, "no partial or duplicate rows from the busy period"


def test_reopen_is_idempotent(module: Any, tmp_path: Path):
    db = tmp_path / "reopen.sqlite3"
    make_legacy_db(db)
    module.LocalLibrary(db).list_history()
    backups_after_first = list(tmp_path.glob("reopen.sqlite3.backup-*"))
    module._INITIALIZED_DATABASES.clear()
    again = module.LocalLibrary(db)
    assert again.list_history()["total"] == 1
    assert version_of(db) == module._TARGET_USER_VERSION
    assert list(tmp_path.glob("reopen.sqlite3.backup-*")) == backups_after_first, "reopening a migrated database creates no new backup"
