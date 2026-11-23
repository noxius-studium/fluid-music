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
import tempfile
from pathlib import Path
from typing import Any

SETTINGS_FILENAME = "fluid-music-settings.json"
MAX_MUSIC_DIR_LENGTH = 4096


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
