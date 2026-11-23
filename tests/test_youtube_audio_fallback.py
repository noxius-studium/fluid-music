"""FM-27 audio-only fallback fixtures.

Labelled doubles + isolated temporary SQLite only: no real yt-dlp network call,
no owner media/credentials, no signed URLs in logs. Proves download-option shape,
local-library registration, settings validation and route contracts — NOT live
provider behavior or real audio (explicit owner review).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, ClassVar, Self

import pytest
from test_plugin_api import app_for, request, run

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

WATCH_URL = "https://www.youtube.com/watch?v=abcdefgh001"


class FakeYoutubeDL:
    """Labelled yt-dlp double: writes a tiny .m4a and reports its real path."""

    options: ClassVar[dict[str, Any]] = {}

    def __init__(self, options: dict[str, Any]) -> None:
        type(self).options = dict(options)

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def extract_info(self, target: str, download: bool = False) -> dict[str, Any]:
        folder = Path(type(self).options["paths"]["home"])
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "fixture - abcdefgh001.m4a"
        path.write_bytes(b"labelled-audio-only-fixture")
        return {
            "id": "abcdefgh001",
            "title": "Fixture Track",
            "requested_downloads": [{"filepath": str(path)}],
        }

    def prepare_filename(self, info: dict[str, Any]) -> str:
        return str(Path(type(self).options["paths"]["home"]) / "fixture - abcdefgh001.m4a")


def test_settings_store_validates_and_persists_without_secrets(api: Any, tmp_path: Path) -> None:
    from dashboard.providers import local_settings

    assert local_settings.music_dir() == ""
    saved = local_settings.set_music_dir("  /tmp/FM Music  ")
    assert saved == "/tmp/FM Music"
    assert local_settings.music_dir() == "/tmp/FM Music"
    data = (tmp_path / "hermes-home" / "plugin-data" / "fluid-music" / "fluid-music-settings.json").read_text()
    assert "music_dir" in data and "token" not in data and "spotify" not in data
    for bad in (None, 42, "", "   ", "x" * 5000, "folder\x00name"):
        with pytest.raises((TypeError, ValueError)):
            local_settings.set_music_dir(bad)


def test_audio_fallback_registers_real_indexed_track(api: Any, tmp_path: Path) -> None:
    from dashboard.local_library import LocalLibrary
    from dashboard.youtube_audio_fallback import download_audio

    folder = tmp_path / "music"
    folder.mkdir()
    library = LocalLibrary(tmp_path / "fallback.sqlite3")
    result = download_audio(
        WATCH_URL, str(folder), library=library, ydl_factory=FakeYoutubeDL,
    )
    assert result["registered"] is True and result["track_id"]
    assert result["video_id"] == "abcdefgh001" and result["title"] == "Fixture Track"
    assert (folder / "fixture - abcdefgh001.m4a").is_file()
    tracks = library.list_tracks()["items"]
    assert any(track["id"] == result["track_id"] for track in tracks)
    options = FakeYoutubeDL.options
    assert options["format"].startswith("bestaudio"), "audio only, never a video+audio merge"
    assert options["noplaylist"] is True and options["overwrites"] is False
    assert options["paths"]["home"] == str(folder)
    assert "merge_output_format" not in options, "no FFmpeg merge step required"


def test_audio_fallback_requires_a_folder_and_never_accepts_empty(api: Any, tmp_path: Path) -> None:
    from dashboard.youtube_audio_fallback import download_audio

    with pytest.raises(ValueError, match="music folder"):
        download_audio(WATCH_URL, "", library=object(), ydl_factory=FakeYoutubeDL)


def test_settings_and_fallback_routes(api: Any, tmp_path: Path) -> None:
    app = app_for(api)

    def get_json(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        return run(request(app, method, path, **kwargs)).json()

    assert get_json("GET", "/settings") == {"ok": True, "data": {"music_dir": "", "spotify_client_id": ""}}
    assert get_json("PUT", "/settings", json={"music_dir": "x" * 5000})["ok"] is False
    assert get_json("PUT", "/settings", json={"music_dir": "/tmp/FM Music"})["data"]["music_dir"] == "/tmp/FM Music"
    assert get_json("GET", "/settings")["data"]["music_dir"] == "/tmp/FM Music"
    assert get_json("POST", "/youtube/fallback/audio", json={"url": "not-a-url"})["ok"] is False
    # A named double for the downloader: no real network/media effect in cloud fixtures.
    import dashboard.youtube_audio_fallback as fallback

    calls: list[dict[str, Any]] = []

    def fake_download(target: str, folder: str, *, library: Any) -> dict[str, Any]:
        calls.append({"target": target, "folder": folder})
        return {"title": "Fixture Track", "video_id": "abcdefgh001", "file": "x.m4a", "track_id": "t1", "registered": True}

    original = fallback.download_audio
    fallback.download_audio = fake_download  # type: ignore[assignment]
    try:
        result = get_json("POST", "/youtube/fallback/audio", json={"url": WATCH_URL})
        assert result["ok"] is True and result["data"]["track_id"] == "t1"
        assert calls == [{"target": WATCH_URL, "folder": "/tmp/FM Music"}]
    finally:
        fallback.download_audio = original  # type: ignore[assignment]
