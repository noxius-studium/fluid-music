"""Profile-local, NON-SECRET FluidMusic settings.

Separate from the protected Spotify credential store: this file holds only
user-chosen paths/UI preferences. Never write tokens, cookies, capability URLs
or media bytes here. Writes are atomic and the active profile home is resolved
at call time so one process can serve many profiles without leakage.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any

SETTINGS_FILENAME = "fluid-music-settings.json"
MAX_MUSIC_DIR_LENGTH = 4096
MAX_SPOTIFY_CLIENT_ID_LENGTH = 128
SPOTIFY_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def settings_path() -> Path:
    constants = importlib.import_module("hermes_constants")
    return Path(constants.get_hermes_home()) / "plugin-data" / "fluid-music" / SETTINGS_FILENAME


def load() -> dict[str, Any]:
    try:
        path = settings_path()
        if not path.is_file():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(data: dict[str, Any]) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle_fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".fm-settings-", suffix=".tmp")
    try:
        with os.fdopen(handle_fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def music_dir() -> str:
    """Return the configured folder or '' when unset/invalid."""
    try:
        value = load().get("music_dir", "")
        return value if isinstance(value, str) and value.strip() else ""
    except Exception:  # noqa: BLE001 - a corrupt settings file is an unset state.
        return ""


def set_music_dir(value: Any) -> str:
    """Validate and persist a user-chosen download folder; never create/scan it here."""
    if not isinstance(value, str):
        raise TypeError("music_dir must be a string")
    folder = value.strip()
    if not folder:
        raise ValueError("music_dir must not be empty")
    if len(folder) > MAX_MUSIC_DIR_LENGTH:
        raise ValueError("music_dir is too long")
    if any(ord(char) < 32 or ord(char) == 127 for char in folder):
        raise ValueError("music_dir contains unsupported characters")
    data = load()
    data["music_dir"] = folder
    save(data)
    return folder


def fallback_root_id() -> str:
    """Stable approved local-library root used by the YouTube audio fallback."""
    try:
        value = str(load().get("fallback_root_id") or "").strip()
        return str(uuid.UUID(value)) if value else ""
    except (AttributeError, TypeError, ValueError):
        return ""


def set_fallback_root_id(value: Any) -> str:
    """Persist an approved scan-root identity, or clear a stale selection."""
    if not isinstance(value, str):
        raise TypeError("fallback_root_id must be a string")
    root_id = value.strip()
    if root_id:
        try:
            root_id = str(uuid.UUID(root_id))
        except ValueError as exc:
            raise ValueError("fallback_root_id must be a UUID") from exc
    data = load()
    if root_id:
        data["fallback_root_id"] = root_id
    else:
        data.pop("fallback_root_id", None)
    save(data)
    return root_id


def spotify_client_id() -> str:
    """Public PKCE app id (never a secret). Returned to the UI for editing."""
    try:
        value = load().get("spotify_client_id", "")
        if isinstance(value, str) and SPOTIFY_CLIENT_ID_RE.fullmatch(value.strip() or "x"):
            return value.strip()
        return ""
    except Exception:  # noqa: BLE001 - corrupt settings are an unset state.
        return ""


def set_spotify_client_id(value: Any) -> str:
    """Validate and persist the public OAuth Authorization Code + PKCE app id."""
    if not isinstance(value, str):
        raise TypeError("spotify_client_id must be a string")
    client_id = value.strip()
    if not client_id:
        raise ValueError("spotify_client_id must not be empty")
    if len(client_id) > MAX_SPOTIFY_CLIENT_ID_LENGTH:
        raise ValueError("spotify_client_id is too long")
    if not SPOTIFY_CLIENT_ID_RE.fullmatch(client_id):
        raise ValueError("spotify_client_id contains unsupported characters")
    data = load()
    data["spotify_client_id"] = client_id
    save(data)
    return client_id
