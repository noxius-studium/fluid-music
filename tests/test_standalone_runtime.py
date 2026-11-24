"""Runtime-loader regressions for Hermes' standalone plugin API import."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from typing import Any, ClassVar, Self

import pytest

ROOT = Path(__file__).resolve().parents[1]


class JsonRequest:
    query_params: ClassVar[dict[str, str]] = {}

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body

    async def json(self) -> dict[str, Any]:
        return self.body


class FakeYoutubeDL:
    def __init__(self, options: dict[str, Any]) -> None:
        self.options = options
        self.path = Path(options["paths"]["home"]) / "fixture-dQw4w9WgXcQ.m4a"

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def extract_info(self, _target: str, download: bool = False) -> dict[str, Any]:
        assert download is True
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(b"standalone-audio-fixture")
        return {
            "id": "dQw4w9WgXcQ",
            "title": "Fixture",
            "requested_downloads": [{"filepath": str(self.path)}],
        }

    def prepare_filename(self, _info: dict[str, Any]) -> str:
        return str(self.path)


def load_standalone(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Any:
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    # Hermes imports plugin_api.py by file path. The plugin root is not a
    # package search root, so `from dashboard...` imports must not work here.
    monkeypatch.chdir(tmp_path)
    for entry in list(sys.path):
        candidate = Path(entry or ".").resolve()
        if candidate == ROOT:
            monkeypatch.setattr(sys, "path", [value for value in sys.path if value != entry])
    for name in list(sys.modules):
        if name == "dashboard" or name.startswith("dashboard."):
            monkeypatch.delitem(sys.modules, name, raising=False)
    module_name = "hermes_dashboard_plugin_fluid_music_standalone_test"
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(module_name, ROOT / "dashboard" / "plugin_api.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_standalone_runtime_reaches_settings_and_audio_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    api = load_standalone(monkeypatch, tmp_path)

    settings = asyncio.run(api.get_settings())
    spotify_status = asyncio.run(api.spotify_auth_status())
    spotify_start = asyncio.run(api.spotify_auth_start(JsonRequest({})))
    fallback = asyncio.run(
        api.youtube_audio_fallback(
            JsonRequest({"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
        )
    )

    assert settings == {
        "ok": True,
        "data": {"music_dir": "", "fallback_root_id": "", "spotify_client_id": ""},
    }
    assert spotify_status["ok"] is True
    assert spotify_status["data"]["auth"] == {"logged_in": False}
    assert spotify_start == {
        "ok": False,
        "error": "A public Spotify Client ID is needed for one-time setup. Use the setup details, then Connect Spotify.",
    }
    assert fallback == {
        "ok": False,
        "error": "Choose a YouTube fallback folder under Library › Local first.",
    }


def test_spotify_provider_is_self_contained(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # A foreign Spotify-shaped plugin must not become a runtime dependency.
    foreign = tmp_path / "hermes-home" / "plugins" / "spotify"
    foreign.mkdir(parents=True)
    (foreign / "__init__.py").write_text("raise RuntimeError('must not import')\n", encoding="utf-8")
    api = load_standalone(monkeypatch, tmp_path)

    client, _error, status, _login, _prepare, _complete, _cancel, client_id, redirect_uri, dashboard = (
        api._load_spotify_integration()
    )

    assert client.__module__.startswith("hermes_fluid_music_providers.")
    assert status() == {"logged_in": False}
    assert client_id() is None
    assert redirect_uri() == "http://127.0.0.1:41337/spotify/callback"
    assert dashboard == "https://developer.spotify.com/dashboard"


def test_standalone_audio_fallback_reaches_the_real_factory_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    api = load_standalone(monkeypatch, tmp_path)
    fallback_module = api._load_dashboard_module("youtube_audio_fallback")
    settings = api._load_dashboard_module("providers.local_settings")
    music = tmp_path / "music"
    settings.set_music_dir(str(music))
    monkeypatch.setattr(fallback_module, "_youtube_dl_factory", lambda: FakeYoutubeDL)

    class Library:
        def list_roots(self) -> list[dict[str, str]]:
            return [{"id": "09a59109-077d-5eac-a6f3-c5fea90d0677", "path": str(music)}]

        def add_root(self, _folder: str) -> None:
            return None

        def list_tracks(self, limit: int) -> dict[str, Any]:
            assert limit == 5_000
            return {"items": [{"id": "track-1", "path": str(music / "fixture-dQw4w9WgXcQ.m4a")}]}

    monkeypatch.setattr(api, "_local_library", lambda: Library())
    result = asyncio.run(
        api.youtube_audio_fallback(
            JsonRequest({"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
        )
    )

    assert result["ok"] is True
    assert result["data"]["track_id"] == "track-1"
