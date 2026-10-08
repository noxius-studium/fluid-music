"""Router and release-contract tests for FluidMusic; all provider collaborators are mocked."""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import json
import subprocess
import sys
import threading
import types
import zipfile
from pathlib import Path
from typing import Any, ClassVar

import httpx
import pytest
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[1]


class FakeSpotifyError(RuntimeError):
    status_code = None


class FakeSpotifyClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.thread_id: int | None = None

    def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        self.thread_id = threading.get_ident()
        self.calls.append((method, path, kwargs))
        return {"method": method, "path": path}

    def get_playback_state(self) -> dict[str, Any]:
        self.thread_id = threading.get_ident()
        return {"is_playing": True}


class FakeResponse:
    def __init__(self, payload: Any, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self._payload


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Import the API in isolation from a Hermes installation."""
    client_module = types.ModuleType("plugins.spotify.client")
    client_module.SpotifyClient = FakeSpotifyClient
    client_module.SpotifyError = FakeSpotifyError
    auth_module = types.ModuleType("hermes_cli.auth")
    auth_module.get_spotify_auth_status = lambda: {"logged_in": False}
    auth_module.login_spotify_command = lambda _args: None
    constants_module = types.ModuleType("hermes_cli.auth_constants")
    constants_module.SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard"
    auth_spotify_module = types.ModuleType("hermes_cli.auth_spotify")
    auth_spotify_module._spotify_client_id = lambda: "configured-client-id"
    auth_spotify_module._spotify_redirect_uri = lambda: "http://127.0.0.1:43827/spotify/callback"
    hermes_constants_module = types.ModuleType("hermes_constants")
    hermes_constants_module.get_hermes_home = lambda: tmp_path / "hermes-home"
    scope_calls: list[tuple[str, Any]] = []
    hermes_constants_module.set_hermes_home_override = (
        lambda home: scope_calls.append(("home-set", home)) or "home-token"
    )
    hermes_constants_module.reset_hermes_home_override = (
        lambda token: scope_calls.append(("home-reset", token))
    )
    profiles_module = types.ModuleType("hermes_cli.profiles")
    profiles_module.validate_profile_name = lambda _profile: None
    profiles_module.profile_exists = lambda profile: profile == "default"
    profiles_module.get_profile_dir = lambda profile: tmp_path / "profiles" / profile
    env_loader_module = types.ModuleType("hermes_cli.env_loader")
    env_loader_module.hydrate_profile_secret_sources = (
        lambda home: scope_calls.append(("hydrate", home))
    )
    agent_module = types.ModuleType("agent")
    secret_scope_module = types.ModuleType("agent.secret_scope")
    secret_scope_module.build_profile_secret_scope = (
        lambda home: scope_calls.append(("secret-build", home)) or {"profile": str(home)}
    )
    secret_scope_module.set_secret_scope = (
        lambda scope, **kwargs: scope_calls.append(("secret-set", (scope, kwargs))) or "secret-token"
    )
    secret_scope_module.reset_secret_scope = (
        lambda token: scope_calls.append(("secret-reset", token))
    )
    monkeypatch.setitem(sys.modules, "plugins", types.ModuleType("plugins"))
    monkeypatch.setitem(sys.modules, "plugins.spotify", types.ModuleType("plugins.spotify"))
    monkeypatch.setitem(sys.modules, "plugins.spotify.client", client_module)
    monkeypatch.setitem(sys.modules, "hermes_cli", types.ModuleType("hermes_cli"))
    monkeypatch.setitem(sys.modules, "hermes_cli.auth", auth_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.auth_constants", constants_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.auth_spotify", auth_spotify_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.profiles", profiles_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.env_loader", env_loader_module)
    monkeypatch.setitem(sys.modules, "hermes_constants", hermes_constants_module)
    monkeypatch.setitem(sys.modules, "agent", agent_module)
    monkeypatch.setitem(sys.modules, "agent.secret_scope", secret_scope_module)
    sys.modules.pop("dashboard.plugin_api", None)
    module = importlib.import_module("dashboard.plugin_api")
    module._scope_calls = scope_calls
    yield module
    sys.modules.pop("dashboard.plugin_api", None)


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


class DeferredThread:
    """A deterministic stand-in for the browser/auth callback worker."""

    instances: ClassVar[list[DeferredThread]] = []

    def __init__(self, *, target: Any, args: tuple[Any, ...], daemon: bool, name: str) -> None:
        self.target = target
        self.args = args
        self.daemon = daemon
        self.name = name
        self.started = False
        self.instances.append(self)

    def start(self) -> None:
        self.started = True

    def complete(self) -> None:
        self.target(*self.args)


@pytest.fixture
def deferred_thread(monkeypatch: pytest.MonkeyPatch, api: Any):
    DeferredThread.instances = []
    monkeypatch.setattr(api.threading, "Thread", DeferredThread)
    return DeferredThread


def test_plugin_identity_manifest_and_register_contract():
    manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    plugin_yaml = (ROOT / "plugin.yaml").read_text(encoding="utf-8")
    spec = importlib.util.spec_from_file_location("fluid_music_plugin", ROOT / "__init__.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert plugin_yaml.splitlines()[0] == "name: fluid-music"
    assert not any(line.startswith("api:") for line in plugin_yaml.splitlines())
    assert manifest["name"] == "fluid-music"
    assert manifest["api"] == "plugin_api.py"
    assert manifest["tab"]["hidden"] is True
    assert module.register(object()) is None
    assert "register" in module.__all__


def test_router_level_spotify_and_radio_work_runs_off_event_loop(api: Any, monkeypatch: pytest.MonkeyPatch):
    radio_thread_ids: list[int] = []

    def fake_get(*_args: Any, **_kwargs: Any) -> FakeResponse:
        radio_thread_ids.append(threading.get_ident())
        return FakeResponse([])

    monkeypatch.setattr(api.httpx, "get", fake_get)
    app = app_for(api)
    main_thread = threading.get_ident()

    player = run(request(app, "GET", "/player"))
    radio = run(request(app, "GET", "/radio/search?q=independent+radio"))

    assert player.json()["ok"] is True
    assert radio.json() == {"ok": True, "data": {"stations": []}}
    assert api._client.thread_id != main_thread
    assert radio_thread_ids and all(thread_id != main_thread for thread_id in radio_thread_ids)


def test_profile_dependency_binds_home_and_secret_scope(api: Any):
    response = run(request(app_for(api), "GET", "/config?profile=default"))

    assert response.status_code == 200
    assert [name for name, _value in api._scope_calls] == [
        "home-set",
        "hydrate",
        "secret-build",
        "secret-set",
        "secret-reset",
        "home-reset",
    ]


def test_router_level_spotify_network_error_is_safe(api: Any, monkeypatch: pytest.MonkeyPatch):
    class NetworkClient:
        def get_playback_state(self) -> dict[str, Any]:
            raise httpx.ConnectError("https://secret.example/token")

    monkeypatch.setattr(api, "SpotifyClient", NetworkClient)
    api._client = None

    response = run(request(app_for(api), "GET", "/player"))

    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["error"] == "Spotify request failed"
    assert "secret.example" not in response.text


def test_devices_uses_official_endpoint_and_falls_back_to_active_player(api: Any, monkeypatch: pytest.MonkeyPatch):
    async def fake_call(function: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
        if function is api._spotify_request:
            assert _args == ("GET", "/me/player/devices")
            return {"ok": False, "error": "Spotify request failed", "status_code": 410}
        assert function is api._spotify_playback_state
        return {
            "ok": True,
            "data": {
                "device": {
                    "id": "phone-1",
                    "name": "Phone",
                    "type": "Smartphone",
                    "is_active": True,
                }
            },
        }

    monkeypatch.setattr(api, "_call", fake_call)

    response = run(request(app_for(api), "GET", "/devices"))

    assert response.json() == {
        "ok": True,
        "data": {
            "devices": [{
                "id": "phone-1",
                "name": "Phone",
                "type": "Smartphone",
                "is_active": True,
            }]
        },
    }


@pytest.mark.parametrize("status_code", [401, 403, 429])
def test_devices_propagates_discovery_errors_without_a_second_player_request(api: Any, monkeypatch: pytest.MonkeyPatch, status_code: int):
    calls: list[tuple[Any, tuple[Any, ...]]] = []

    async def fake_call(function: Any, *args: Any, **_kwargs: Any) -> dict[str, Any]:
        calls.append((function, args))
        if function is api._spotify_request:
            return {"ok": False, "error": "Spotify request failed", "status_code": status_code}
        raise AssertionError("device discovery errors must not trigger a player fallback")

    monkeypatch.setattr(api, "_call", fake_call)

    response = run(request(app_for(api), "GET", "/devices"))

    assert response.json() == {"ok": False, "error": "Spotify request failed", "status_code": status_code}
    assert calls == [(api._spotify_request, ("GET", "/me/player/devices"))]


def test_spotify_library_and_seek_routes_shape_validated_upstream_requests(api: Any, monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[Any, tuple[Any, ...], dict[str, Any]]] = []

    async def fake_call(function: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        calls.append((function, args, kwargs))
        return {"ok": True, "data": {}}

    monkeypatch.setattr(api, "_call", fake_call)
    app = app_for(api)

    seek = run(request(app, "PUT", "/seek", json={"position_ms": 12_345, "device_id": "phone-1"}))
    playlists = run(request(app, "GET", "/playlists?limit=12&offset=24"))
    tracks = run(request(app, "GET", "/playlists/3cEYpjA9oz9GiPac4AsH4n/tracks?limit=25&offset=50"))
    search = run(request(app, "GET", "/search?q=night+drive&type=track,album,artist,playlist&limit=50&offset=20"))

    assert all(response.json()["ok"] is True for response in (seek, playlists, tracks, search))
    assert calls == [
        (api._spotify_request, ("PUT", "/me/player/seek"), {"params": {"position_ms": 12_345, "device_id": "phone-1"}}),
        (api._spotify_request, ("GET", "/me/playlists"), {"params": {"limit": 12, "offset": 24}}),
        (api._spotify_request, ("GET", "/playlists/3cEYpjA9oz9GiPac4AsH4n/items"), {"params": {"limit": 25, "offset": 50}}),
        (api._spotify_request, ("GET", "/search"), {"params": {"q": "night drive", "type": "track,album,artist,playlist", "limit": 10, "offset": 20}}),
    ]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PUT", "/seek", {"position_ms": "NaN"}),
        ("GET", "/playlists/not-valid!/tracks", None),
        ("GET", "/search?q=music&type=track,unknown", None),
    ],
)
def test_spotify_library_routes_reject_invalid_inputs(api: Any, method: str, path: str, body: Any):
    response = run(request(app_for(api), method, path, json=body))

    assert response.status_code == 200
    assert response.json()["ok"] is False


def test_spotify_auth_status_whitelists_hermes_metadata_and_flow(api: Any, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api, "get_spotify_auth_status", lambda: {
        "logged_in": True,
        "auth_type": "oauth_pkce",
        "client_id": "public-client-id",
        "redirect_uri": "http://127.0.0.1:43827/spotify/callback",
        "scope": "user-read-playback-state",
        "expires_at": "2026-09-21T12:08:33+00:00",
        "api_base_url": "https://api.spotify.com/v1",
        "has_refresh_token": True,
        "access_token": "must-not-reach-renderer",
        "refresh_token": "must-not-reach-renderer",
    })

    response = run(request(app_for(api), "GET", "/spotify/auth/status"))

    assert response.json() == {
        "ok": True,
        "data": {
            "auth": {
                "logged_in": True,
                "auth_type": "oauth_pkce",
                "client_id": "public-client-id",
                "redirect_uri": "http://127.0.0.1:43827/spotify/callback",
                "scope": "user-read-playback-state",
                "expires_at": "2026-09-21T12:08:33+00:00",
                "api_base_url": "https://api.spotify.com/v1",
                "has_refresh_token": True,
            },
            "setup": {
                "client_id_required": False,
                "redirect_uri": "http://127.0.0.1:43827/spotify/callback",
                "developer_dashboard_url": "https://developer.spotify.com/dashboard",
            },
            "flow": {"state": "idle", "error": None},
        },
    }
    assert "must-not-reach-renderer" not in response.text


def test_spotify_auth_start_runs_one_daemon_hermes_worker(api: Any, monkeypatch: pytest.MonkeyPatch, deferred_thread: type[DeferredThread]):
    received: list[Any] = []
    monkeypatch.setattr(api, "login_spotify_command", received.append)
    monkeypatch.setattr(api, "_configured_spotify_client_id", lambda: "")
    api._client = object()

    response = run(request(app_for(api), "POST", "/spotify/auth/start", json={"client_id": "Abc_123-client"}))

    assert response.json() == {"ok": True, "data": {"flow": {"state": "in_progress", "error": None}}}
    assert len(deferred_thread.instances) == 1
    worker = deferred_thread.instances[0]
    assert worker.started is True
    assert worker.daemon is True
    assert worker.name == "fluid-music-spotify-auth"

    worker.complete()

    assert vars(received[0]) == {
        "client_id": "Abc_123-client",
        "redirect_uri": None,
        "scope": None,
        "no_browser": False,
        "timeout": 180,
    }
    assert api._client is None
    assert run(request(app_for(api), "GET", "/spotify/auth/status")).json()["data"]["flow"] == {
        "state": "succeeded",
        "error": None,
    }


def test_spotify_auth_start_rejects_duplicate_in_progress_flow(api: Any, deferred_thread: type[DeferredThread]):
    app = app_for(api)

    assert run(request(app, "POST", "/spotify/auth/start")).json()["ok"] is True
    duplicate = run(request(app, "POST", "/spotify/auth/start", json={"client_id": "second-client"}))

    assert duplicate.json() == {"ok": False, "error": "Spotify authentication is already in progress"}
    assert len(deferred_thread.instances) == 1
    assert deferred_thread.instances[0].args == (None,)


def test_spotify_auth_status_guides_one_time_public_client_id_setup(api: Any, monkeypatch: pytest.MonkeyPatch, deferred_thread: type[DeferredThread]):
    def no_configured_client_id() -> str:
        raise RuntimeError("not configured")

    monkeypatch.setattr(api, "_configured_spotify_client_id", no_configured_client_id)
    monkeypatch.setattr(api, "_spotify_redirect_uri", lambda: "http://127.0.0.1:55123/spotify/callback")

    status = run(request(app_for(api), "GET", "/spotify/auth/status"))
    start = run(request(app_for(api), "POST", "/spotify/auth/start"))

    assert status.json()["data"]["setup"] == {
        "client_id_required": True,
        "redirect_uri": "http://127.0.0.1:55123/spotify/callback",
        "developer_dashboard_url": "https://developer.spotify.com/dashboard",
    }
    assert start.json() == {
        "ok": False,
        "error": "A public Spotify Client ID is needed for one-time setup. Use the setup details, then Connect Spotify.",
    }
    assert len(deferred_thread.instances) == 0


@pytest.mark.parametrize("client_id", ["", "x" * 129, "not/allowed", 123])
def test_spotify_auth_start_validates_optional_client_id(api: Any, deferred_thread: type[DeferredThread], client_id: Any):
    response = run(request(app_for(api), "POST", "/spotify/auth/start", json={"client_id": client_id}))

    assert response.json()["ok"] is False
    assert len(deferred_thread.instances) == 0
    if client_id:
        assert str(client_id) not in response.text


def test_spotify_auth_worker_records_only_safe_completion_error(api: Any, monkeypatch: pytest.MonkeyPatch, deferred_thread: type[DeferredThread]):
    def fail_auth(_args: Any) -> None:
        raise RuntimeError("access_token=secret https://accounts.spotify.com/authorize?client_id=client-id")

    monkeypatch.setattr(api, "login_spotify_command", fail_auth)
    api._client = object()

    assert run(request(app_for(api), "POST", "/spotify/auth/start")).json()["ok"] is True
    deferred_thread.instances[0].complete()
    response = run(request(app_for(api), "GET", "/spotify/auth/status"))

    assert response.json()["data"]["flow"] == {
        "state": "failed",
        "error": "Spotify authorization did not complete. Select Connect Spotify to retry.",
    }
    assert api._client is None
    assert "secret" not in response.text
    assert "accounts.spotify.com" not in response.text
    assert "client-id" not in response.text


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_router_level_numeric_parser_rejects_nonfinite_values(api: Any, value: str):
    response = run(request(app_for(api), "PUT", "/volume", json={"volume_percent": value}))

    assert response.status_code == 200
    assert response.json() == {"ok": False, "error": "volume_percent must be a finite number"}


def test_numeric_parsers_handle_overflow_without_crashing(api: Any):
    class OverflowingNumber:
        def __float__(self) -> float:
            raise OverflowError("overflow")

    assert api._bounded_int("Infinity", 8, 1, 20) == 8
    with pytest.raises(ValueError, match="position_ms must be a number"):
        api._strict_bounded_int(OverflowingNumber(), 0, 10, "position_ms")


def test_router_level_radio_search_uses_fixed_directory_and_filters_unsafe_streams(api: Any, monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[str, dict[str, Any]]] = []

    def fake_get(url: str, **kwargs: Any) -> FakeResponse:
        calls.append((url, kwargs))
        return FakeResponse([
            {"stationuuid": "b30b1e1e-6e7e-4a4e-9876-a5bb13be0c60", "name": "Safe FM", "url_resolved": "https://radio.example/live.mp3", "tags": "pop", "codec": "MP3"},
            {"stationuuid": "b30b1e1e-6e7e-4a4e-9876-a5bb13be0c61", "name": "Private", "url_resolved": "https://127.0.0.1/admin"},
            {"stationuuid": "b30b1e1e-6e7e-4a4e-9876-a5bb13be0c62", "name": "HLS", "url_resolved": "https://radio.example/live.m3u8", "tags": "news,hls"},
        ])

    monkeypatch.setattr(api.httpx, "get", fake_get)
    response = run(request(app_for(api), "GET", "/radio/search?q=safe+music&limit=200"))

    assert response.json() == {
        "ok": True,
        "data": {
            "stations": [{
                "stationuuid": "b30b1e1e-6e7e-4a4e-9876-a5bb13be0c60",
                "name": "Safe FM",
                "url": "https://radio.example/live.mp3",
                "tags": "pop",
                "codec": "MP3",
            }],
        },
    }
    assert calls[0][0] == api.RADIO_BROWSER_SEARCH_URL
    assert calls[0][1]["params"]["limit"] == 50
    assert calls[0][1]["follow_redirects"] is False


def test_local_library_persists_roots_tracks_and_identity_across_moves(api: Any, tmp_path: Path):
    music = tmp_path / "Music"
    album = music / "Artist" / "Album"
    album.mkdir(parents=True)
    original = album / "First.mp3"
    original.write_bytes(b"ID3" + b"a" * 256)
    (album / "cover.txt").write_text("not audio", encoding="utf-8")
    database = tmp_path / "state" / "library.sqlite3"

    library = api.LocalLibrary(database)
    added = library.add_root(str(music))
    first = library.list_tracks()

    assert added["scan"] == {"roots_scanned": 1, "available_tracks": 1, "missing_tracks": 0, "errors": []}
    assert first["total"] == 1
    assert first["items"][0]["title"] == "First"
    assert first["items"][0]["available"] is True
    stable_id = first["items"][0]["id"]

    moved = album / "Renamed.mp3"
    original.rename(moved)
    second_process = api.LocalLibrary(database)
    second_process.scan()
    after_move = second_process.list_tracks()["items"]

    assert len(after_move) == 1
    assert after_move[0]["id"] == stable_id
    assert after_move[0]["path"] == str(moved)

    moved.unlink()
    second_process.scan()
    missing = second_process.list_tracks()["items"][0]
    assert missing["id"] == stable_id
    assert missing["available"] is False


def test_local_library_routes_index_selected_folder_and_survive_new_repository(api: Any, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    music = tmp_path / "Music"
    music.mkdir()
    track = music / "Persistent.flac"
    track.write_bytes(b"fLaC" + b"b" * 128)
    database = tmp_path / "library.sqlite3"
    monkeypatch.setattr(api, "_local_library", lambda: api.LocalLibrary(database))
    app = app_for(api)

    added = run(request(app, "POST", "/local/roots", json={"path": str(music)}))
    roots = run(request(app, "GET", "/local/roots"))
    tracks = run(request(app, "GET", "/local/tracks"))

    assert added.json()["ok"] is True
    assert roots.json()["data"]["roots"][0]["path"] == str(music)
    assert tracks.json()["data"]["total"] == 1
    item = tracks.json()["data"]["items"][0]
    assert item["title"] == "Persistent"
    assert item["path"] == str(track)
    assert item["available"] is True

    # A fresh repository object proves persistence is SQLite-owned, not process memory.
    assert api.LocalLibrary(database).get_track(item["id"])["path"] == str(track)


def test_router_exposes_frontend_contract(api: Any):
    routes = {(route.path, method) for route in api.router.routes for method in route.methods}
    expected = {
        ("/config", "GET"), ("/player", "GET"), ("/devices", "GET"),
        ("/spotify/auth/status", "GET"), ("/spotify/auth/start", "POST"),
        ("/play", "POST"), ("/pause", "POST"), ("/next", "POST"), ("/previous", "POST"),
        ("/volume", "PUT"), ("/seek", "PUT"), ("/transfer", "PUT"), ("/queue", "GET"), ("/queue", "POST"),
        ("/shuffle", "PUT"), ("/repeat", "PUT"), ("/search", "GET"), ("/playlists", "GET"),
        ("/playlists/{playlist_id}/tracks", "GET"),
        ("/local/roots", "GET"), ("/local/roots", "POST"),
        ("/local/roots/{root_id}", "DELETE"), ("/local/rescan", "POST"),
        ("/local/tracks", "GET"), ("/local/tracks/{track_id}", "GET"),
        ("/radio/search", "GET"), ("/radio/click/{stationuuid}", "POST"),
    }
    assert expected <= routes
    assert not any("youtube" in path.lower() for path, _method in routes)


def test_release_archive_has_complete_unified_install_tree(tmp_path: Path):
    output = tmp_path / "fluid-music.zip"
    second_output = tmp_path / "fluid-music-again.zip"
    completed = subprocess.run(
        [sys.executable, "scripts/package.py", "--output", str(output)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [sys.executable, "scripts/package.py", "--output", str(second_output)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    assert Path(completed.stdout.strip()) == output.resolve()
    assert output.read_bytes() == second_output.read_bytes()
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        assert names == sorted(names)
        assert all(name.startswith("fluid-music/") for name in names)
        assert {
            "fluid-music/plugin.yaml",
            "fluid-music/__init__.py",
            "fluid-music/pyproject.toml",
            "fluid-music/dashboard/__init__.py",
            "fluid-music/dashboard/manifest.json",
            "fluid-music/dashboard/plugin_api.py",
            "fluid-music/dashboard/local_library.py",
            "fluid-music/desktop/plugin.js",
            "fluid-music/README.md",
            "fluid-music/LICENSE",
            "fluid-music/docs/architecture.md",
            "fluid-music/docs/limitations.md",
        } <= set(names)
        assert {info.date_time for info in archive.infolist()} == {(1980, 1, 1, 0, 0, 0)}
