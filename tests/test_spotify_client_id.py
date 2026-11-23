"""FM-28 Spotify Client ID setting fixtures.

The client id is a PUBLIC PKCE identifier — never a secret, never a token.
Labelled doubles only; no real Spotify account/network effect.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest
from test_plugin_api import app_for, request, run

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))


def test_client_id_is_validated_and_profile_local(api: Any, tmp_path: Path) -> None:
    from dashboard.providers import local_settings

    assert local_settings.spotify_client_id() == ""
    assert local_settings.set_spotify_client_id("  Abc123_-XYZ  ") == "Abc123_-XYZ"
    assert local_settings.spotify_client_id() == "Abc123_-XYZ"
    data = (tmp_path / "hermes-home" / "plugin-data" / "fluid-music" / "fluid-music-settings.json").read_text()
    assert "Abc123_-XYZ" in data and "secret" not in data and "token" not in data
    for bad in (None, 42, "", " ", "with space", "x/y", "x" * 129):
        with pytest.raises((TypeError, ValueError)):
            local_settings.set_spotify_client_id(bad)


def test_settings_roundtrip_keeps_both_fields_independent(api: Any) -> None:
    app = app_for(api)

    def call(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        return run(request(app, method, path, **kwargs)).json()

    assert call("GET", "/settings")["data"] == {"music_dir": "", "spotify_client_id": ""}
    assert call("PUT", "/settings", json={"spotify_client_id": "Client_123"})["data"]["spotify_client_id"] == "Client_123"
    assert call("PUT", "/settings", json={"music_dir": "/tmp/Music"})["data"]["music_dir"] == "/tmp/Music"
    data = call("GET", "/settings")["data"]
    assert data == {"music_dir": "/tmp/Music", "spotify_client_id": "Client_123"}
    assert call("PUT", "/settings", json={"spotify_client_id": "x/y"})["ok"] is False
    assert call("GET", "/settings")["data"]["spotify_client_id"] == "Client_123"


def test_saved_client_id_is_used_for_auth_without_a_body_value(api: Any, deferred_thread: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_for(api)
    run(request(app, "PUT", "/settings", json={"spotify_client_id": "SavedClient123"}))
    # Force the setup gate to depend on our saved setting rather than the
    # host-configured double from the shared fixture.
    monkeypatch.setattr(api, "_configured_spotify_client_id", lambda: None)
    response = run(request(app, "POST", "/spotify/auth/start")).json()
    assert response["ok"] is True, "the saved public PKCE id satisfies one-time setup"


def test_owned_provider_reads_the_saved_client_id(api: Any, tmp_path: Path) -> None:
    """configured_client_id falls back to the owned settings store."""
    from dashboard.providers import local_settings

    sys.modules.pop("hermes_fluid_music_providers", None)
    configured_client_id = api._load_spotify_integration()[4]
    assert configured_client_id() is None
    local_settings.set_spotify_client_id("ProviderClient9")
    assert configured_client_id() == "ProviderClient9"
