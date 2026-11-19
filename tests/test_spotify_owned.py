"""FluidMusic-owned Spotify OAuth/PKCE + token-store fixtures (FM-09).

Labelled cloud fixtures: httpx.MockTransport doubles and isolated temporary
profile homes. NO real Spotify credentials, network calls or account
operations. Live OAuth/login/playback remain owner Desktop acceptance (FM-25).
"""

from __future__ import annotations

import base64
import hashlib
import importlib
import importlib.util
import json
import stat
import sys
import threading
import types
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def owned(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    home_holder = {"home": tmp_path / "profile-a"}
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: home_holder["home"]
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    for name in list(sys.modules):
        if name.startswith("hermes_fluid_music_providers"):
            monkeypatch.delitem(sys.modules, name, raising=False)
    providers_root = ROOT / "dashboard" / "providers"
    spec = importlib.util.spec_from_file_location(
        "hermes_fluid_music_providers",
        providers_root / "__init__.py",
        submodule_search_locations=[str(providers_root)],
    )
    assert spec and spec.loader
    package = importlib.util.module_from_spec(spec)
    sys.modules["hermes_fluid_music_providers"] = package
    spec.loader.exec_module(package)
    spotify = importlib.import_module("hermes_fluid_music_providers.spotify")
    store = importlib.import_module("hermes_fluid_music_providers.token_store")
    return types.SimpleNamespace(spotify=spotify, store=store, home=home_holder)


def token_payload(access: str = "access-1", refresh: str = "refresh-1", expires_in: int = 3600) -> dict[str, Any]:
    return {"access_token": access, "refresh_token": refresh, "expires_in": expires_in, "scope": "user-read-playback-state", "token_type": "Bearer"}


def seed_connected(owned: Any, access: str = "access-1", expired: bool = False) -> None:
    owned.store.save({
        "client_id": "cid",
        "access_token": access,
        "refresh_token": "refresh-1",
        "scope": "user-read-playback-state",
        "expires_at": "2020-01-01T00:00:00+00:00" if expired else "2999-01-01T00:00:00+00:00",
        "token_type": "Bearer",
        "account": {"id": "owner", "display_name": "Owner"},
    })


def test_pkce_verifier_challenge_and_authorize_url_follow_the_official_contract(owned: Any):
    spotify = owned.spotify
    verifier, challenge = spotify._new_pkce()
    assert 43 <= len(verifier) <= 128
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    assert challenge == expected
    url = spotify._authorize_url("cid", "state-123", challenge)
    parsed = urlparse(url)
    assert parsed.scheme == "https" and parsed.hostname == "accounts.spotify.com" and parsed.path == "/authorize"
    params = parse_qs(parsed.query)
    assert params["client_id"] == ["cid"]
    assert params["response_type"] == ["code"]
    assert params["redirect_uri"] == ["http://127.0.0.1:43827/spotify/callback"]
    assert params["state"] == ["state-123"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["code_challenge"] == [challenge]
    assert "user-modify-playback-state" in params["scope"][0]
    assert "playlist-read-private" in params["scope"][0]


def test_code_exchange_stores_protected_tokens_and_binds_the_account(owned: Any):
    spotify = owned.spotify
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/token":
            body = parse_qs(request.content.decode())
            assert body["grant_type"] == ["authorization_code"]
            assert body["code"] == ["auth-code"]
            assert body["code_verifier"] == ["verifier"]
            assert body["redirect_uri"] == ["http://127.0.0.1:43827/spotify/callback"]
            return httpx.Response(200, json=token_payload())
        if request.url.path == "/v1/me":
            assert request.headers["Authorization"] == "Bearer access-1"
            return httpx.Response(200, json={"id": "owner", "display_name": "Owner"})
        return httpx.Response(404)

    data = spotify._exchange_code("cid", "auth-code", "verifier", transport=httpx.MockTransport(handler))
    assert data["account"] == {"id": "owner", "display_name": "Owner", "product": ""}
    path = owned.store.credentials_path()
    assert path.is_file()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600, "credentials must be owner-only"
    status = spotify.auth_status()
    assert status["logged_in"] is True
    assert status["auth_type"] == "oauth_pkce"
    assert status["has_refresh_token"] is True
    assert status["account"]["id"] == "owner"
    # Raw tokens never appear in UI-safe status.
    assert "access-1" not in json.dumps(status)
    assert "refresh-1" not in json.dumps(status)


def test_callback_state_replay_and_timeout_are_rejected(owned: Any):
    spotify = owned.spotify
    with pytest.raises(spotify.SpotifyError) as mismatch:
        spotify._consume_callback({"state": "wrong", "code": "c"}, "expected")
    assert mismatch.value.code == "spotify_state_mismatch"
    with pytest.raises(spotify.SpotifyError) as declined:
        spotify._consume_callback({"error": "access_denied", "state": "expected"}, "expected")
    assert declined.value.code == "spotify_auth_declined"
    with pytest.raises(spotify.SpotifyError) as timeout:
        spotify._consume_callback({"state": "expected"}, "expected")
    assert timeout.value.code == "spotify_callback_timeout"
    assert spotify._consume_callback({"state": "expected", "code": "auth-code"}, "expected") == "auth-code"
    assert owned.store.load() == {}, "rejected callbacks never store credentials"


def test_missing_login_is_disconnected_and_requests_fail_honestly(owned: Any):
    spotify = owned.spotify
    assert spotify.auth_status() == {"logged_in": False}
    client = spotify.SpotifyClient(transport=httpx.MockTransport(lambda request: pytest.fail("no HTTP without login")))
    with pytest.raises(spotify.SpotifyError) as exc:
        client.request("GET", "/me/player")
    assert exc.value.status_code == 401
    assert exc.value.code == "spotify_not_connected"


def test_expired_token_refreshes_single_flight_under_concurrent_requests(owned: Any):
    spotify = owned.spotify
    seed_connected(owned, expired=True)
    refresh_calls: list[str] = []
    api_calls: list[str] = []
    lock = threading.Lock()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/token":
            with lock:
                refresh_calls.append(parse_qs(request.content.decode())["grant_type"][0])
            return httpx.Response(200, json=token_payload(access="access-2"))
        with lock:
            api_calls.append(request.headers["Authorization"])
        return httpx.Response(200, json={"is_playing": False})

    client = spotify.SpotifyClient(transport=httpx.MockTransport(handler))
    results: list[Any] = []
    errors: list[BaseException] = []

    def work() -> None:
        try:
            results.append(client.request("GET", "/me/player"))
        except BaseException as exc:  # noqa: BLE001 - fixture records any failure
            errors.append(exc)

    threads = [threading.Thread(target=work) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert not errors
    assert len(results) == 4
    assert refresh_calls == ["refresh_token"], "concurrent expiry triggers exactly ONE refresh"
    assert api_calls == ["Bearer access-2"] * 4
    assert owned.store.load()["access_token"] == "access-2"


def test_api_401_retries_once_after_refresh(owned: Any):
    spotify = owned.spotify
    seed_connected(owned, access="stale-access")
    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/token":
            return httpx.Response(200, json=token_payload(access="fresh-access"))
        attempts.append(request.headers["Authorization"])
        if request.headers["Authorization"] == "Bearer stale-access":
            return httpx.Response(401, json={"error": {"message": "The access token expired"}})
        return httpx.Response(200, json={"is_playing": True})

    client = spotify.SpotifyClient(transport=httpx.MockTransport(handler))
    assert client.get_playback_state() == {"is_playing": True}
    assert attempts == ["Bearer stale-access", "Bearer fresh-access"]


def test_failed_refresh_clears_credentials_and_never_fakes_connected(owned: Any):
    spotify = owned.spotify
    seed_connected(owned, expired=True)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    client = spotify.SpotifyClient(transport=httpx.MockTransport(handler))
    with pytest.raises(spotify.SpotifyError) as exc:
        client.request("GET", "/me/player")
    assert exc.value.status_code == 401
    assert exc.value.code == "spotify_refresh_failed"
    assert owned.store.load() == {}
    assert spotify.auth_status() == {"logged_in": False}


def test_logout_revokes_best_effort_and_always_removes_local_credentials(owned: Any):
    spotify = owned.spotify
    seed_connected(owned)
    revoked: list[dict[str, list[str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = parse_qs(request.content.decode())
        revoked.append(body)
        return httpx.Response(200)

    result = spotify.logout(transport=httpx.MockTransport(handler))
    assert result == {"logged_in": False, "revoked": True}
    assert revoked[0]["token_type_hint"] == ["refresh_token"]
    assert owned.store.load() == {}
    assert spotify.auth_status() == {"logged_in": False}

    seed_connected(owned)
    result = spotify.logout(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    assert result["revoked"] is False
    assert owned.store.load() == {}, "local removal never depends on provider revoke success"


def test_two_profile_homes_do_not_share_credentials(owned: Any, tmp_path: Path):
    spotify = owned.spotify
    seed_connected(owned)
    assert spotify.auth_status()["logged_in"] is True
    owned.home["home"] = tmp_path / "profile-b"
    assert spotify.auth_status() == {"logged_in": False}
    assert owned.store.load() == {}
    owned.store.save({"client_id": "cid-b", "access_token": "b", "refresh_token": "rb", "expires_at": "2999-01-01T00:00:00+00:00"})
    owned.home["home"] = tmp_path / "profile-a"
    assert owned.store.load()["access_token"] == "access-1"


def test_provider_errors_are_sanitized(owned: Any):
    spotify = owned.spotify
    seed_connected(owned)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"message": "access_token=secret leaked in provider text"}})

    client = spotify.SpotifyClient(transport=httpx.MockTransport(handler))
    with pytest.raises(spotify.SpotifyError) as exc:
        client.request("GET", "/me")
    assert str(exc.value) == "Spotify request failed"
    assert "secret" not in str(exc.value)


def test_no_core_or_sibling_spotify_implementation_imports_remain():
    forbidden = (
        "from hermes_cli.auth", "import hermes_cli.auth",
        "from plugins.spotify", "import plugins.spotify",
        "spotify_auth.py", "spotify_client.py",
        "hermes_fluid_music_spotify", 'glob("spotify-',
    )
    offenders: list[str] = []
    for path in (ROOT / "dashboard").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for marker in forbidden:
            if marker in text:
                offenders.append(f"{path.relative_to(ROOT)}: {marker}")
    assert offenders == [], f"delegated Spotify implementation references remain: {offenders}"
