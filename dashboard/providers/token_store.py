"""Protected profile-local Spotify credential store.

Credentials live in a 0600 file under the ACTIVE profile's
``plugin-data/fluid-music`` directory — separate from the public SQLite
history/library database, never in renderer storage, logs or exports. Writes
are atomic (temp file + rename). The profile home is resolved at call time so
one process can serve many profiles without cross-profile leakage.

Legacy credential stores (Hermes auth store, older Spotify plugins) are never
read, copied or migrated here; a fresh owner sign-in is required.
"""

from __future__ import annotations

import importlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

CREDENTIALS_FILENAME = "spotify-credentials.json"


def credentials_path() -> Path:
    # Resolve the host home at CALL time so per-profile overrides (and test
    # doubles) always bind to the active profile, never a stale import.
    constants = importlib.import_module("hermes_constants")
    return Path(constants.get_hermes_home()) / "plugin-data" / "fluid-music" / CREDENTIALS_FILENAME


def load() -> dict[str, Any]:
    try:
        path = credentials_path()
        if not path.is_file():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(data: dict[str, Any]) -> None:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle_fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".spotify-cred-", suffix=".tmp")
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


def clear() -> None:
    try:
        credentials_path().unlink()
    except FileNotFoundError:
        pass
