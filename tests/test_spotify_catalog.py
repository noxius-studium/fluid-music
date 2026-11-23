"""Route-level Spotify catalogue fixtures (FM-11).

Labelled cloud fixtures: the OWNED SpotifyClient against httpx.MockTransport
with isolated temporary profile homes. Proves official endpoint paths,
pagination parameters, validation-before-provider and scope-error
propagation. Zero real Spotify credentials, network calls or account writes.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import types
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi import FastAPI


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    sys.modules.pop("dashboard.plugin_api", None)
    module = importlib.import_module("dashboard.plugin_api")
    provider = module._load_dashboard_module("providers.spotify")
    module.SpotifyClient = provider.SpotifyClient
    module.SpotifyError = provider.SpotifyError
    module.get_spotify_auth_status = provider.auth_status
    module._spotify_integration_ready = True
    store = module._load_dashboard_module("providers.token_store")
    store.save({
        "client_id": "cid",
        "access_token": "access-1",
        "refresh_token": "refresh-1",
        "scope": "playlist-read-private playlist-read-collaborative user-library-read",
        "expires_at": "2999-01-01T00:00:00+00:00",
        "token_type": "Bearer",
        "account": {"id": "owner", "display_name": "Owner", "product": "premium"},
    })
    yield module, store
    sys.modules.pop("dashboard.plugin_api", None)


def run(awaitable: Any) -> Any:
    return asyncio.run(awaitable)


async def request(api: Any, method: str, path: str, **kwargs: Any) -> httpx.Response:
    module, _store = api
    app = FastAPI()
    app.include_router(module.router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


def install_transport(api: Any, handler: Any) -> list[httpx.Request]:
    module, _store = api
    owned_client = module.SpotifyClient
    seen: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    module.SpotifyClient = lambda: owned_client(transport=httpx.MockTransport(recording_handler))
    return seen


def catalogue_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/v1/me/playlists":
        return httpx.Response(200, json={"items": [{"id": "p1", "name": "Mix", "uri": "spotify:playlist:p1", "public": False, "collaborative": False, "owner": {"display_name": "Owner"}, "images": [], "tracks": {"total": 3}}], "total": 1, "next": None})
    if request.url.path == "/v1/playlists/p1/tracks":
        return httpx.Response(200, json={"items": [{"track": {"id": "t1", "uri": "spotify:track:t1", "name": "One", "artists": []}}, {"track": None}], "total": 2, "next": None})
    if request.url.path == "/v1/search":
        return httpx.Response(200, json={"tracks": {"items": [], "next": None}})
    return httpx.Response(404)


def test_playlist_pages_use_the_official_tracks_endpoint_with_pagination(api: Any):
    seen = install_transport(api, catalogue_handler)
    playlists = run(request(api, "GET", "/playlists?limit=12&offset=24")).json()
    assert playlists["ok"] is True
    tracks = run(request(api, "GET", "/playlists/p1/tracks?limit=25&offset=50")).json()
    assert tracks["ok"] is True
    by_path = {r.url.path: r for r in seen}
    assert "/v1/playlists/p1/tracks" in by_path, "official endpoint, never /items"
    assert "/v1/playlists/p1/items" not in by_path
    assert parse_qs(by_path["/v1/me/playlists"].url.query.decode()) == {"limit": ["12"], "offset": ["24"]}
    assert parse_qs(by_path["/v1/playlists/p1/tracks"].url.query.decode()) == {"limit": ["25"], "offset": ["50"]}
    assert by_path["/v1/playlists/p1/tracks"].headers["Authorization"] == "Bearer access-1"


def test_invalid_playlist_ids_and_search_inputs_never_reach_the_provider(api: Any):
    seen = install_transport(api, catalogue_handler)
    assert run(request(api, "GET", "/playlists/bad%20id/tracks")).json()["ok"] is False
    assert run(request(api, "GET", "/search?q=")).json()["ok"] is False
    assert run(request(api, "GET", "/search?q=night&type=bogus")).json()["ok"] is False
    assert seen == []


def test_search_pagination_bounds_and_type_whitelist(api: Any):
    seen = install_transport(api, catalogue_handler)
    body = run(request(api, "GET", "/search?q=night+drive&type=track,album,artist,playlist&limit=50&offset=2000")).json()
    assert body["ok"] is True
    params = parse_qs(seen[0].url.query.decode())
    assert params["q"] == ["night drive"]
    assert params["type"] == ["track,album,artist,playlist"]
    assert params["limit"] == ["10"], "limit clamps to the official small-page bound"
    assert params["offset"] == ["1000"], "offset clamps to the provider bound"


def test_insufficient_scope_errors_propagate_distinctly(api: Any):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"message": "Insufficient client scope"}})

    install_transport(api, handler)
    body = run(request(api, "GET", "/playlists")).json()
    assert body["ok"] is False
    assert body["status_code"] == 403
    assert "scope" in body["error"].lower()


def test_catalogue_reads_never_write_to_remote_playlists(api: Any):
    seen = install_transport(api, catalogue_handler)
    run(request(api, "GET", "/playlists"))
    run(request(api, "GET", "/playlists/p1/tracks"))
    run(request(api, "GET", "/search?q=night"))
    assert all(r.method == "GET" for r in seen), "browse/library workflows are read-only; no surprise remote writes"
