"""Route-level Spotify transport payload fixtures (FM-10).

Labelled cloud fixtures: the OWNED SpotifyClient runs against
httpx.MockTransport doubles with isolated temporary profile homes. These
prove the ACTUAL outgoing provider payloads, status distinctions and
idempotent refresh — zero real Spotify credentials or network calls. Real
Connect playback remains owner Desktop acceptance (FM-25).
"""

from __future__ import annotations

import asyncio
import importlib
import json
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
        "scope": "user-modify-playback-state",
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


def ok_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/v1/me/player/devices":
        return httpx.Response(200, json={"devices": [{"id": "dev-1", "name": "Phone", "is_active": True, "is_restricted": False}]})
    if request.url.path == "/v1/me/player":
        return httpx.Response(200, json={"is_playing": False})
    return httpx.Response(204)


def test_play_preserves_context_offset_and_exact_duplicate_uris(api: Any):
    seen = install_transport(api, ok_handler)
    body = run(request(api, "POST", "/play", json={
        "context_uri": "spotify:album:abc",
        "offset": 3,
        "uris": ["spotify:track:a", "spotify:track:a", "spotify:track:b"],
    })).json()
    assert body["ok"] is True
    play = [r for r in seen if r.url.path == "/v1/me/player/play"]
    assert len(play) == 1
    payload = json.loads(play[0].content)
    assert payload["context_uri"] == "spotify:album:abc"
    assert payload["offset"] == {"position": 3}
    assert payload["uris"] == ["spotify:track:a", "spotify:track:a", "spotify:track:b"], "exact duplicates preserved"
    assert play[0].method == "PUT"


def test_transport_commands_send_the_official_payloads(api: Any):
    seen = install_transport(api, ok_handler)
    assert run(request(api, "PUT", "/volume", json={"volume_percent": 55, "device_id": "dev-1"})).json()["ok"] is True
    assert run(request(api, "PUT", "/seek", json={"position_ms": 12345})).json()["ok"] is True
    assert run(request(api, "PUT", "/shuffle", json={"state": True})).json()["ok"] is True
    assert run(request(api, "PUT", "/repeat", json={"state": "context"})).json()["ok"] is True
    assert run(request(api, "POST", "/queue", json={"uri": "spotify:track:a"})).json()["ok"] is True
    assert run(request(api, "PUT", "/transfer", json={"device_id": "dev-1", "play": False})).json()["ok"] is True
    assert run(request(api, "POST", "/pause", json={"device_id": "dev-1"})).json()["ok"] is True
    assert run(request(api, "POST", "/next", json={})).json()["ok"] is True
    assert run(request(api, "POST", "/previous", json={})).json()["ok"] is True

    by_path = {r.url.path: r for r in seen}
    volume = by_path["/v1/me/player/volume"]
    assert parse_qs(volume.url.query.decode())["volume_percent"] == ["55"]
    assert parse_qs(volume.url.query.decode())["device_id"] == ["dev-1"]
    assert parse_qs(by_path["/v1/me/player/seek"].url.query.decode())["position_ms"] == ["12345"]
    assert parse_qs(by_path["/v1/me/player/shuffle"].url.query.decode())["state"] == ["true"]
    assert parse_qs(by_path["/v1/me/player/repeat"].url.query.decode())["state"] == ["context"]
    assert parse_qs(by_path["/v1/me/player/queue"].url.query.decode())["uri"] == ["spotify:track:a"]
    transfer = json.loads(by_path["/v1/me/player"].content)
    assert transfer == {"device_ids": ["dev-1"], "play": False}
    assert by_path["/v1/me/player/next"].method == "POST"
    assert by_path["/v1/me/player/previous"].method == "POST"
    assert all(r.headers["Authorization"] == "Bearer access-1" for r in seen)


def test_invalid_transport_inputs_never_reach_the_provider(api: Any):
    seen = install_transport(api, ok_handler)
    assert run(request(api, "PUT", "/seek", json={"position_ms": "NaN"})).json()["ok"] is False
    assert run(request(api, "PUT", "/repeat", json={"state": "bogus"})).json()["ok"] is False
    assert run(request(api, "POST", "/play", json={"uris": ["not-a-spotify-uri"]})).json()["ok"] is False
    assert run(request(api, "PUT", "/transfer", json={})).json()["ok"] is False
    assert run(request(api, "PUT", "/volume", json={})).json()["ok"] is False
    assert seen == [], "rejected inputs never reach the provider"


def test_out_of_range_finite_values_clamp_to_official_bounds(api: Any):
    # Established contract: finite out-of-range values clamp BEFORE sending;
    # the provider never sees an illegal value.
    seen = install_transport(api, ok_handler)
    assert run(request(api, "PUT", "/volume", json={"volume_percent": 101})).json()["ok"] is True
    assert run(request(api, "PUT", "/volume", json={"volume_percent": -5})).json()["ok"] is True
    percents = [parse_qs(r.url.query.decode())["volume_percent"][0] for r in seen if r.url.path == "/v1/me/player/volume"]
    assert percents == ["100", "0"]


@pytest.mark.parametrize("status", [403, 429, 500, 503])
def test_player_errors_propagate_distinct_status_codes(api: Any, status: int):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"message": "provider problem"}})

    install_transport(api, handler)
    body = run(request(api, "GET", "/player")).json()
    assert body["ok"] is False
    assert body["status_code"] == status


def test_no_device_and_not_found_are_distinct(api: Any):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/search":
            return httpx.Response(404, json={"error": {"message": "Not found"}})
        return httpx.Response(410, json={"error": {"message": "Device gone"}})

    install_transport(api, handler)
    search = run(request(api, "GET", "/search?q=night")).json()
    assert search["ok"] is False and search["status_code"] == 404
    player = run(request(api, "GET", "/player")).json()
    assert player["ok"] is False and player["status_code"] == 410


def test_expired_token_refreshes_idempotently_across_requests(api: Any):
    _module, store = api
    data = store.load()
    data["expires_at"] = "2020-01-01T00:00:00+00:00"
    store.save(data)
    refresh_calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/token":
            refresh_calls.append(parse_qs(request.content.decode())["grant_type"][0])
            return httpx.Response(200, json={"access_token": "access-2", "expires_in": 3600, "token_type": "Bearer"})
        assert request.headers["Authorization"] == "Bearer access-2"
        return httpx.Response(200, json={"is_playing": False})

    install_transport(api, handler)
    first = run(request(api, "GET", "/player")).json()
    second = run(request(api, "GET", "/player")).json()
    assert first["ok"] is True and second["ok"] is True
    assert refresh_calls == ["refresh_token"], "the second request reuses the refreshed token"
    assert store.load()["access_token"] == "access-2"


def test_provider_error_text_with_tokens_is_sanitized(api: Any):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"message": "access_token=secret leaked"}})

    install_transport(api, handler)
    response = run(request(api, "GET", "/player"))
    assert response.json()["error"] == "Spotify request failed"
    assert "secret" not in response.text


def test_local_capability_route_is_honest_and_never_certifies_audio(api: Any):
    install_transport(api, ok_handler)
    body = run(request(api, "GET", "/spotify/local-capability")).json()
    assert body["ok"] is True
    data = body["data"]
    assert data["account_product"] == "premium"
    assert data["local_audio"] == "unverified"
    assert data["sdk"] == "unverified"
    assert data["encrypted_media"] == "unverified"
    assert data["provider_approval"] == "unverified"
    assert data["connect_control"] is True
