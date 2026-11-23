"""FluidMusic-owned audio-only YouTube fallback.

When the embed/watch engine fails for eligible content, this adapter downloads
AUDIO ONLY with yt-dlp, prefers a native m4a stream (no FFmpeg/merge step), puts
the file in the owner-configured music folder, registers that folder as a local
library root and returns the indexed track for later use. It never downloads
video, never logs provider URLs/credentials, and is bounded (no playlist, fixed
retries/timeout). Live provider/media effects only happen on the owner's Desktop
with a real account; cloud fixtures use a labelled yt-dlp double.

ToS: the owner accepted personal-use responsibility for yt-dlp in the 2026-11-21
feedback. FluidMusic supplies the software path only; no DRM/paid-access bypass.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

YOUTUBE_WATCH = "https://www.youtube.com/watch?v={video_id}"

# Extract an 11-char id from the already-validated canonical watch URL.
def _video_id(target: str) -> str:
    from urllib.parse import parse_qs, urlparse

    return str(parse_qs(urlparse(target).query).get("v", [""])[0])[:11]


def _youtube_dl_factory() -> Any:
    from yt_dlp import YoutubeDL

    return YoutubeDL


def _downloaded_file(client: Any, info: dict[str, Any], music_dir: str, video_id: str) -> Path | None:
    for entry in info.get("requested_downloads") or []:
        candidate = entry.get("filepath") or entry.get("_filename")
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    try:
        prepared = client.prepare_filename(info)
        if prepared and Path(prepared).is_file():
            return Path(prepared)
    except Exception:
        logger.debug("prepare_filename failed; falling back to directory scan", exc_info=True)
    try:
        matches = sorted(
            (path for path in Path(music_dir).glob(f"*{video_id}*.m4a") if path.is_file()),
            key=lambda path: path.stat().st_mtime_ns,
            reverse=True,
        )
        return matches[0] if matches else None
    except OSError:
        return None


def download_audio(
    target: str,
    music_dir: str,
    *,
    library: Any,
    ydl_factory: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Download audio-only m4a, register it in the local library, return the track.

    ``library`` is the profile-scoped LocalLibrary (or a labelled double).
    ``ydl_factory`` is injectable only for fixtures; the real path uses yt-dlp.
    """
    folder = str(music_dir or "").strip()
    if not folder:
        raise ValueError("Set a music folder in Settings before using the audio fallback.")
    video_id = _video_id(str(target or ""))
    if not video_id:
        raise ValueError("A valid YouTube video is needed for the audio fallback.")
    options = {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 12,
        "retries": 2,
        "overwrites": False,
        "restrictfilenames": True,
        "paths": {"home": folder},
        "outtmpl": "%(title).150B - %(id)s.%(ext)s",
    }
    factory: Any = ydl_factory or _youtube_dl_factory
    with factory(options) as client:
        info = client.extract_info(target, download=True) or {}
        downloaded = _downloaded_file(client, info, folder, video_id)
    if downloaded is None or not downloaded.is_file():
        raise RuntimeError("The audio download did not produce a file.")
    # Registering an existing folder is idempotent (canonical-key upsert) and
    # rescans it; the downloaded file becomes an indexed, later-usable track.
    library.add_root(folder)
    tracks = (library.list_tracks(limit=5_000) or {}).get("items", [])
    match = next((track for track in tracks if str(track.get("path", "")) == str(downloaded)), None)
    return {
        "title": str(info.get("title") or downloaded.stem)[:200],
        "video_id": video_id,
        "file": downloaded.name,
        "track_id": str(match["id"]) if match else "",
        "registered": bool(match),
    }
