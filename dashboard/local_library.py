"""Persistent, profile-scoped local music catalog for FluidMusic.

The catalog stores only user-approved scan roots, stable track identifiers, and
file metadata. Audio bytes never enter SQLite. Playback remains the desktop
host's responsibility through its seekable media protocol.
"""

from __future__ import annotations

import hashlib
import mimetypes
import os
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

PLUGIN_NAME = "fluid-music"
SUPPORTED_AUDIO_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".oga",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
_MAX_TRACKS_PER_SCAN = 50_000
_FINGERPRINT_CHUNK_BYTES = 64 * 1024
_SCHEMA_LOCK = threading.Lock()
_INITIALIZED_DATABASES: set[str] = set()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def default_database_path() -> Path:
    """Resolve the active profile at call time; one process may serve many."""
    return Path(get_hermes_home()) / "plugin-data" / PLUGIN_NAME / "library.sqlite3"


def _canonical_key(path: Path) -> str:
    canonical = os.path.normpath(str(path))
    return os.path.normcase(canonical)


def _stable_track_id(canonical_path: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"fluid-music:local:{canonical_path}"))


def _fingerprint(path: Path, size_bytes: int) -> str:
    """Fingerprint enough file content to preserve identity after a move."""
    digest = hashlib.sha256()
    digest.update(str(size_bytes).encode("ascii"))
    with path.open("rb") as handle:
        digest.update(handle.read(_FINGERPRINT_CHUNK_BYTES))
        if size_bytes > _FINGERPRINT_CHUNK_BYTES:
            handle.seek(max(0, size_bytes - _FINGERPRINT_CHUNK_BYTES))
            digest.update(handle.read(_FINGERPRINT_CHUNK_BYTES))
    return digest.hexdigest()


def _track_title(path: Path) -> str:
    return path.stem.strip() or path.name


class LocalLibrary:
    """SQLite repository plus bounded, permission-rooted scanner."""

    def __init__(self, database_path: Path | None = None) -> None:
        self.database_path = Path(database_path) if database_path is not None else default_database_path()

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        self._ensure_schema(connection)
        return connection

    def _ensure_schema(self, connection: sqlite3.Connection) -> None:
        key = str(self.database_path.resolve())
        if key in _INITIALIZED_DATABASES:
            return
        with _SCHEMA_LOCK:
            if key in _INITIALIZED_DATABASES:
                return
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS scan_roots (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL,
                    canonical_key TEXT NOT NULL UNIQUE,
                    added_at TEXT NOT NULL,
                    last_scanned_at TEXT,
                    last_scan_count INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS local_tracks (
                    id TEXT PRIMARY KEY,
                    root_id TEXT NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
                    path TEXT NOT NULL,
                    canonical_key TEXT NOT NULL UNIQUE,
                    relative_path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    mtime_ns INTEGER NOT NULL,
                    fingerprint TEXT NOT NULL,
                    available INTEGER NOT NULL DEFAULT 1,
                    discovered_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS local_tracks_root_available
                    ON local_tracks(root_id, available, relative_path);
                CREATE INDEX IF NOT EXISTS local_tracks_fingerprint
                    ON local_tracks(root_id, fingerprint);
                """
            )
            connection.commit()
            _INITIALIZED_DATABASES.add(key)

    @staticmethod
    def _root_path(value: Any) -> Path:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("path is required")
        if len(value) > 4_096 or "\x00" in value:
            raise ValueError("path is invalid")
        path = Path(value).expanduser()
        if not path.is_absolute():
            raise ValueError("path must be absolute")
        try:
            resolved = path.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise ValueError("folder does not exist or is not readable") from exc
        if resolved.is_file():
            resolved = resolved.parent
        if not resolved.is_dir():
            raise ValueError("path must identify a folder")
        try:
            next(resolved.iterdir(), None)
        except OSError as exc:
            raise ValueError("folder does not exist or is not readable") from exc
        return resolved

    @staticmethod
    def _root_id(canonical_key: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"fluid-music:root:{canonical_key}"))

    @staticmethod
    def _validate_uuid(value: Any, field: str) -> str:
        try:
            return str(uuid.UUID(str(value)))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError(f"{field} must be a UUID") from exc

    def add_root(self, path_value: Any) -> dict[str, Any]:
        root = self._root_path(path_value)
        canonical = _canonical_key(root)
        root_id = self._root_id(canonical)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO scan_roots(id, path, canonical_key, added_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(canonical_key) DO UPDATE SET path = excluded.path
                """,
                (root_id, str(root), canonical, _now()),
            )
        scan = self.scan(root_id)
        return {"root": self.get_root(root_id), "scan": scan}

    def get_root(self, root_id: Any) -> dict[str, Any]:
        safe_id = self._validate_uuid(root_id, "root_id")
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT r.*, COUNT(t.id) AS track_count,
                       COALESCE(SUM(CASE WHEN t.available = 0 THEN 1 ELSE 0 END), 0) AS missing_count
                FROM scan_roots r
                LEFT JOIN local_tracks t ON t.root_id = r.id
                WHERE r.id = ?
                GROUP BY r.id
                """,
                (safe_id,),
            ).fetchone()
        if row is None:
            raise ValueError("scan root was not found")
        return self._root_row(row)

    def list_roots(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT r.*, COUNT(t.id) AS track_count,
                       COALESCE(SUM(CASE WHEN t.available = 0 THEN 1 ELSE 0 END), 0) AS missing_count
                FROM scan_roots r
                LEFT JOIN local_tracks t ON t.root_id = r.id
                GROUP BY r.id
                ORDER BY r.path COLLATE NOCASE
                """
            ).fetchall()
        return [self._root_row(row) for row in rows]

    @staticmethod
    def _root_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "path": row["path"],
            "added_at": row["added_at"],
            "last_scanned_at": row["last_scanned_at"],
            "last_scan_count": int(row["last_scan_count"]),
            "track_count": int(row["track_count"]),
            "missing_count": int(row["missing_count"]),
        }

    def remove_root(self, root_id: Any) -> bool:
        safe_id = self._validate_uuid(root_id, "root_id")
        with self._connect() as connection:
            deleted = connection.execute("DELETE FROM scan_roots WHERE id = ?", (safe_id,)).rowcount
        return bool(deleted)

    def _audio_files(self, root: Path):
        count = 0
        for directory, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames.sort(key=str.casefold)
            filenames.sort(key=str.casefold)
            for filename in filenames:
                path = Path(directory) / filename
                if path.suffix.lower() not in SUPPORTED_AUDIO_EXTENSIONS or path.is_symlink():
                    continue
                count += 1
                if count > _MAX_TRACKS_PER_SCAN:
                    raise ValueError(f"scan exceeds the {_MAX_TRACKS_PER_SCAN:,}-track safety limit")
                yield path

    def scan(self, root_id: Any | None = None) -> dict[str, Any]:
        safe_root_id = self._validate_uuid(root_id, "root_id") if root_id is not None else None
        with self._connect() as connection:
            if safe_root_id:
                roots = connection.execute("SELECT * FROM scan_roots WHERE id = ?", (safe_root_id,)).fetchall()
                if not roots:
                    raise ValueError("scan root was not found")
            else:
                roots = connection.execute("SELECT * FROM scan_roots ORDER BY path COLLATE NOCASE").fetchall()

        scanned = 0
        available = 0
        missing = 0
        errors: list[dict[str, str]] = []
        for row in roots:
            try:
                result = self._scan_root(row)
                scanned += 1
                available += result["available"]
                missing += result["missing"]
            except (OSError, ValueError) as exc:
                errors.append({"root_id": row["id"], "error": str(exc)})
        return {
            "roots_scanned": scanned,
            "available_tracks": available,
            "missing_tracks": missing,
            "errors": errors,
        }

    def _scan_root(self, root_row: sqlite3.Row) -> dict[str, int]:
        root = Path(root_row["path"])
        try:
            resolved_root = root.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            self._mark_root_missing(root_row["id"])
            raise ValueError("configured folder is currently unavailable") from exc
        if not resolved_root.is_dir():
            self._mark_root_missing(root_row["id"])
            raise ValueError("configured folder is currently unavailable")

        with self._connect() as connection:
            existing_rows = connection.execute(
                "SELECT * FROM local_tracks WHERE root_id = ?",
                (root_row["id"],),
            ).fetchall()
        by_path = {row["canonical_key"]: row for row in existing_rows}
        missing_by_fingerprint: dict[str, list[sqlite3.Row]] = {}
        for row in existing_rows:
            if not Path(row["path"]).exists():
                missing_by_fingerprint.setdefault(row["fingerprint"], []).append(row)

        seen_ids: set[str] = set()
        scanned_at = _now()
        with self._connect() as connection:
            for path in self._audio_files(resolved_root):
                try:
                    stat = path.stat()
                    canonical = _canonical_key(path.resolve(strict=True))
                    relative = str(path.relative_to(resolved_root))
                    fingerprint = _fingerprint(path, stat.st_size)
                except (OSError, ValueError, RuntimeError):
                    continue

                existing = by_path.get(canonical)
                if existing is not None:
                    track_id = existing["id"]
                    discovered_at = existing["discovered_at"]
                else:
                    relink = missing_by_fingerprint.get(fingerprint, [])
                    prior = relink.pop(0) if len(relink) == 1 else None
                    track_id = prior["id"] if prior is not None else _stable_track_id(canonical)
                    discovered_at = prior["discovered_at"] if prior is not None else scanned_at

                mime_type = mimetypes.guess_type(path.name)[0] or "audio/unknown"
                connection.execute(
                    """
                    INSERT INTO local_tracks(
                        id, root_id, path, canonical_key, relative_path, title,
                        mime_type, size_bytes, mtime_ns, fingerprint, available,
                        discovered_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        root_id = excluded.root_id,
                        path = excluded.path,
                        canonical_key = excluded.canonical_key,
                        relative_path = excluded.relative_path,
                        title = excluded.title,
                        mime_type = excluded.mime_type,
                        size_bytes = excluded.size_bytes,
                        mtime_ns = excluded.mtime_ns,
                        fingerprint = excluded.fingerprint,
                        available = 1,
                        updated_at = excluded.updated_at
                    """,
                    (
                        track_id,
                        root_row["id"],
                        str(path),
                        canonical,
                        relative,
                        _track_title(path),
                        mime_type,
                        stat.st_size,
                        stat.st_mtime_ns,
                        fingerprint,
                        discovered_at,
                        scanned_at,
                    ),
                )
                seen_ids.add(track_id)

            if seen_ids:
                placeholders = ",".join("?" for _ in seen_ids)
                connection.execute(
                    f"UPDATE local_tracks SET available = 0, updated_at = ? WHERE root_id = ? AND id NOT IN ({placeholders})",
                    (scanned_at, root_row["id"], *sorted(seen_ids)),
                )
            else:
                connection.execute(
                    "UPDATE local_tracks SET available = 0, updated_at = ? WHERE root_id = ?",
                    (scanned_at, root_row["id"]),
                )
            counts = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       COALESCE(SUM(CASE WHEN available = 0 THEN 1 ELSE 0 END), 0) AS missing
                FROM local_tracks WHERE root_id = ?
                """,
                (root_row["id"],),
            ).fetchone()
            connection.execute(
                "UPDATE scan_roots SET path = ?, canonical_key = ?, last_scanned_at = ?, last_scan_count = ? WHERE id = ?",
                (str(resolved_root), _canonical_key(resolved_root), scanned_at, int(counts["total"]), root_row["id"]),
            )
        return {"available": int(counts["total"]) - int(counts["missing"]), "missing": int(counts["missing"])}

    def _mark_root_missing(self, root_id: str) -> None:
        now = _now()
        with self._connect() as connection:
            connection.execute(
                "UPDATE local_tracks SET available = 0, updated_at = ? WHERE root_id = ?",
                (now, root_id),
            )
            connection.execute(
                "UPDATE scan_roots SET last_scanned_at = ?, last_scan_count = 0 WHERE id = ?",
                (now, root_id),
            )

    def list_tracks(
        self,
        *,
        root_id: Any | None = None,
        include_missing: bool = True,
        limit: int = 2_000,
        offset: int = 0,
    ) -> dict[str, Any]:
        clauses: list[str] = []
        params: list[Any] = []
        if root_id is not None:
            clauses.append("t.root_id = ?")
            params.append(self._validate_uuid(root_id, "root_id"))
        if not include_missing:
            clauses.append("t.available = 1")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        bounded_limit = max(1, min(5_000, int(limit)))
        bounded_offset = max(0, int(offset))
        with self._connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM local_tracks t {where}",
                params,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT t.*, r.path AS root_path
                FROM local_tracks t
                JOIN scan_roots r ON r.id = t.root_id
                {where}
                ORDER BY t.available DESC, t.title COLLATE NOCASE, t.relative_path COLLATE NOCASE
                LIMIT ? OFFSET ?
                """,
                (*params, bounded_limit, bounded_offset),
            ).fetchall()
        return {"items": [self._track_row(row) for row in rows], "total": int(total)}

    def get_track(self, track_id: Any) -> dict[str, Any]:
        safe_id = self._validate_uuid(track_id, "track_id")
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT t.*, r.path AS root_path
                FROM local_tracks t JOIN scan_roots r ON r.id = t.root_id
                WHERE t.id = ?
                """,
                (safe_id,),
            ).fetchone()
        if row is None:
            raise ValueError("local track was not found")
        return self._track_row(row)

    @staticmethod
    def _track_row(row: sqlite3.Row) -> dict[str, Any]:
        available = bool(row["available"])
        path = row["path"]
        if available and not Path(path).is_file():
            available = False
        parent = str(Path(row["relative_path"]).parent)
        return {
            "id": row["id"],
            "root_id": row["root_id"],
            "path": path,
            "relative_path": row["relative_path"],
            "title": row["title"],
            "subtitle": parent if parent not in {"", "."} else Path(row["root_path"]).name,
            "mime_type": row["mime_type"],
            "size_bytes": int(row["size_bytes"]),
            "mtime_ns": int(row["mtime_ns"]),
            "available": available,
            "updated_at": row["updated_at"],
        }
