"""Optional-provider boundary tests for the FluidMusic backend.

Labelled cloud fixtures: these tests inject a minimal Hermes host stand-in
(``hermes_constants`` pointing at a temporary directory) and deliberately
provide NO Spotify integration — no core ``hermes_cli`` auth modules and no
sibling ``spotify-*`` plugin.  They prove the import/route contract only:
a missing optional provider must never abort the backend module or take down
YouTube, radio, local-library or history routes.  They are not live Spotify,
audio or packaged-Desktop evidence.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import sys
import types
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[1]


def run(awaitable: Any) -> Any:
    return asyncio.run(awaitable)


async def request(app: FastAPI, method: str, path: str, **kwargs: Any) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


def app_for(api: Any) -> FastAPI:
    app = FastAPI()
    app.include_router(api.router)
    return app


def _clear_spotify_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in list(sys.modules):
        if name in {"plugins", "hermes_cli", "hermes_fluid_music_spotify"} or name.startswith(
            ("plugins.", "hermes_cli.", "hermes_fluid_music_spotify.")
        ):
            monkeypatch.delitem(sys.modules, name, raising=False)


@pytest.fixture
def host_only_api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Import the API with host constants present but Spotify absent."""
    assert importlib.util.find_spec("hermes_cli") is None, "boundary scenario requires no core Spotify"
    _clear_spotify_modules(monkeypatch)
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    sys.modules.pop("dashboard.plugin_api", None)
    module = importlib.import_module("dashboard.plugin_api")
    yield module
    sys.modules.pop("dashboard.plugin_api", None)


@pytest.fixture
def with_spotify_api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Labelled fake Spotify integration for the available-path contract check."""
    client_module = types.ModuleType("plugins.spotify.client")

    class FakeClient:
        def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
            return {"method": method, "path": path}

        def get_playback_state(self) -> dict[str, Any]:
            return {"is_playing": False}

    class FakeError(RuntimeError):
        status_code = None

    client_module.SpotifyClient = FakeClient
    client_module.SpotifyError = FakeError
    auth_module = types.ModuleType("hermes_cli.auth")
    auth_module.get_spotify_auth_status = lambda: {"logged_in": False}
    auth_module.login_spotify_command = lambda _args: None
    constants_module = types.ModuleType("hermes_cli.auth_constants")
    constants_module.SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard"
    auth_spotify_module = types.ModuleType("hermes_cli.auth_spotify")
    auth_spotify_module._spotify_client_id = lambda: "configured-client-id"
    auth_spotify_module._spotify_redirect_uri = lambda: "http://127.0.0.1:43827/spotify/callback"
    hermes_constants = types.ModuleType("hermes_constants")
    hermes_constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "plugins", types.ModuleType("plugins"))
    monkeypatch.setitem(sys.modules, "plugins.spotify", types.ModuleType("plugins.spotify"))
    monkeypatch.setitem(sys.modules, "plugins.spotify.client", client_module)
    monkeypatch.setitem(sys.modules, "hermes_cli", types.ModuleType("hermes_cli"))
    monkeypatch.setitem(sys.modules, "hermes_cli.auth", auth_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.auth_constants", constants_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.auth_spotify", auth_spotify_module)
    monkeypatch.setitem(sys.modules, "hermes_constants", hermes_constants)
    sys.modules.pop("dashboard.plugin_api", None)
    module = importlib.import_module("dashboard.plugin_api")
    yield module
    sys.modules.pop("dashboard.plugin_api", None)


def test_backend_imports_and_mounts_non_spotify_routes_without_spotify(host_only_api: Any):
    routes = {route.path for route in host_only_api.router.routes}
    assert {
        "/config",
        "/youtube/embed-host",
        "/youtube/search",
        "/youtube/resolve",
        "/history",
        "/local/roots",
        "/local/rescan",
        "/local/tracks",
        "/radio/search",
        "/radio/click/{stationuuid}",
    } <= routes


def test_spotify_routes_report_explicit_unavailable_without_integration(host_only_api: Any, tmp_path: Path):
    app = app_for(host_only_api)
    status = run(request(app, "GET", "/spotify/auth/status"))
    player = run(request(app, "GET", "/player"))
    search = run(request(app, "GET", "/search?q=night+drive"))
    start = run(request(app, "POST", "/spotify/auth/start", json={"client_id": "Abc_123-client"}))

    for response in (status, player, search, start):
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is False
        assert "spotify" in body["error"].lower()
        assert "unavailable" in body["error"].lower()
        # Sanitized: no filesystem paths, tracebacks or OAuth details leak.
        assert str(tmp_path) not in response.text
        assert "ImportError" not in response.text
        assert "Traceback" not in response.text
    assert status.json()["data"]["flow"] == {"state": "idle", "error": None}


def test_config_reports_honest_capabilities_without_spotify(host_only_api: Any):
    body = run(request(app_for(host_only_api), "GET", "/config")).json()
    assert body["ok"] is True
    capabilities = body["data"]["capabilities"]
    assert capabilities["spotify_connect"]["available"] is False
    assert capabilities["radio_browser"] == {"available": True, "stream_policy": "https-only-no-hls"}


def test_history_roundtrip_works_without_spotify(host_only_api: Any, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    database = tmp_path / "isolated" / "library.sqlite3"
    monkeypatch.setattr(host_only_api, "_local_library", lambda: host_only_api.LocalLibrary(database))
    app = app_for(host_only_api)
    item = {
        "id": "youtube:D-PaXRCXtzE",
        "source": "youtube",
        "url": "https://www.youtube.com/watch?v=D-PaXRCXtzE",
        "title": "Labelled fixture set",
        "subtitle": "Boundary fixture",
        "artwork": "https://i.ytimg.com/vi/D-PaXRCXtzE/hqdefault.jpg",
    }
    added = run(request(app, "POST", "/history", json={"item": item}))
    listed = run(request(app, "GET", "/history"))
    cleared = run(request(app, "DELETE", "/history"))
    assert added.json()["ok"] is True
    assert listed.json()["data"]["total"] == 1
    assert cleared.json()["data"]["removed"] == 1


def test_youtube_routes_work_without_spotify(host_only_api: Any, monkeypatch: pytest.MonkeyPatch):
    def fake_extract(target: str, *, flat: bool) -> Any:
        item = {
            "id": "D-PaXRCXtzE",
            "title": "Labelled fixture video",
            "uploader": "Boundary fixture",
            "duration": 120,
            "thumbnail": "https://i.ytimg.com/vi/D-PaXRCXtzE/hqdefault.jpg",
        }
        return {"entries": [item]} if flat else item

    monkeypatch.setattr(host_only_api, "_youtube_extract", fake_extract)
    app = app_for(host_only_api)
    search = run(request(app, "GET", "/youtube/search?q=fixture"))
    resolved = run(request(app, "POST", "/youtube/resolve", json={"url": "https://youtu.be/D-PaXRCXtzE"}))
    assert search.json()["ok"] is True
    assert search.json()["data"]["items"][0]["title"] == "Labelled fixture video"
    assert resolved.json()["ok"] is True


def test_radio_search_works_without_spotify(host_only_api: Any, monkeypatch: pytest.MonkeyPatch):
    class FakeResponse:
        status_code = 200

        def json(self) -> Any:
            return []

    monkeypatch.setattr(host_only_api.httpx, "get", lambda *_args, **_kwargs: FakeResponse())
    body = run(request(app_for(host_only_api), "GET", "/radio/search?q=fixture")).json()
    assert body == {"ok": True, "data": {"stations": []}}


def test_capabilities_and_player_report_available_with_labelled_integration(with_spotify_api: Any):
    app = app_for(with_spotify_api)
    config = run(request(app, "GET", "/config")).json()
    assert config["ok"] is True
    assert config["data"]["capabilities"]["spotify_connect"]["available"] is True
    player = run(request(app, "GET", "/player")).json()
    assert player["ok"] is True
    assert player["data"] == {"is_playing": False}
