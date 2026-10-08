"""FluidMusic REST API: Spotify Connect controls and a safe Radio Browser index.

Spotify calls deliberately reuse Hermes' bundled ``SpotifyClient``.  It owns
PKCE token refresh, a single 401 retry, and auth-store access, so this plugin
never handles Spotify credentials itself.

Radio stream URLs are returned for the desktop's native player, not fetched by
this backend.  The only outbound Radio Browser requests target fixed HTTPS
endpoints, never follow redirects, and accept no caller-supplied URL.
"""

from __future__ import annotations

import importlib.util
import ipaddress
import logging
import math
import re
import sqlite3
import sys
import threading
import uuid
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse

import anyio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from hermes_cli.auth import get_spotify_auth_status, login_spotify_command
from hermes_cli.auth_constants import SPOTIFY_DASHBOARD_URL
from hermes_cli.auth_spotify import _spotify_client_id as _configured_spotify_client_id
from hermes_cli.auth_spotify import _spotify_redirect_uri
from plugins.spotify.client import SpotifyClient, SpotifyError


async def _profile_scope(profile: str | None = None) -> AsyncIterator[None]:
    """Bind Desktop requests to the selected profile's home and secrets."""
    if profile is None:
        yield
        return
    from agent.secret_scope import (
        build_profile_secret_scope,
        reset_secret_scope,
        set_secret_scope,
    )
    from hermes_cli.env_loader import hydrate_profile_secret_sources
    from hermes_cli.profiles import (
        get_profile_dir,
        profile_exists,
        validate_profile_name,
    )
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    try:
        validate_profile_name(profile)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid profile") from error
    if not profile_exists(profile):
        raise HTTPException(status_code=404, detail="Profile not found")
    profile_home = get_profile_dir(profile)
    home_token = set_hermes_home_override(profile_home)
    secret_token = None
    try:
        hydrate_profile_secret_sources(profile_home)
        secret_token = set_secret_scope(
            build_profile_secret_scope(profile_home),
            profile_home=str(profile_home),
        )
        yield
    finally:
        if secret_token is not None:
            reset_secret_scope(secret_token)
        reset_hermes_home_override(home_token)


router = APIRouter(dependencies=[Depends(_profile_scope)])
logger = logging.getLogger(__name__)


def _load_local_library_class():
    """Load the sibling module even though Hermes imports plugin_api.py standalone."""
    module_name = "hermes_dashboard_plugin_fluid_music_local_library"
    module = sys.modules.get(module_name)
    if module is None:
        module_path = Path(__file__).with_name("local_library.py")
        spec = importlib.util.spec_from_file_location(module_name, module_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("FluidMusic local library module is unavailable")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(module_name, None)
            raise
    return module.LocalLibrary


LocalLibrary = _load_local_library_class()
# Construct lazily: Radio Browser and /config must remain available when the
# user has not yet run `hermes auth spotify`.
_client: SpotifyClient | None = None

PLUGIN_NAME = "fluid-music"
RADIO_BROWSER_SEARCH_URL = "https://de1.api.radio-browser.info/json/stations/search"
RADIO_BROWSER_CLICK_BASE_URL = "https://de1.api.radio-browser.info/json/url"
RADIO_BROWSER_USER_AGENT = "FluidMusic/0.1 (+https://hermes-agent.nousresearch.com)"
_DEFAULT_SETTINGS = {
    "poll_interval_open": 8,
    "poll_interval_closed": 20,
    "radio_search_limit": 20,
}
_MAX_DEVICE_ID_LENGTH = 256
_MAX_SPOTIFY_URI_LENGTH = 500
_MAX_QUERY_LENGTH = 200
_MAX_RADIO_LIMIT = 50
_MAX_SPOTIFY_CLIENT_ID_LENGTH = 128
_SPOTIFY_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{1,64}$")
_SPOTIFY_AUTH_ERROR = "Spotify authentication could not start. Select Connect Spotify to retry."
_spotify_auth_lock = threading.Lock()
_spotify_auth_flow: dict[str, str | None] = {"state": "idle", "error": None}


def _error(message: str) -> dict[str, Any]:
    return {"ok": False, "error": message}


def _spotify_auth_flow_status() -> dict[str, str | None]:
    """Return the UI-safe state of this process's most recent auth attempt."""
    with _spotify_auth_lock:
        return dict(_spotify_auth_flow)


def _spotify_auth_status_data() -> dict[str, Any]:
    """Whitelist Hermes auth-store metadata that is safe for the renderer."""
    status = get_spotify_auth_status()
    if not isinstance(status, Mapping):
        return {"logged_in": False}
    safe_fields = (
        "logged_in",
        "auth_type",
        "client_id",
        "redirect_uri",
        "scope",
        "expires_at",
        "api_base_url",
        "has_refresh_token",
    )
    return {field: status[field] for field in safe_fields if field in status}


def _spotify_client_id(value: Any) -> str | None:
    """Validate the optional public Spotify app client ID without persisting it here."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("client_id must be a string")
    client_id = value.strip()
    if not client_id:
        raise ValueError("client_id must not be empty")
    if len(client_id) > _MAX_SPOTIFY_CLIENT_ID_LENGTH:
        raise ValueError(f"client_id must be at most {_MAX_SPOTIFY_CLIENT_ID_LENGTH} characters")
    if not _SPOTIFY_CLIENT_ID_RE.fullmatch(client_id):
        raise ValueError("client_id contains unsupported characters")
    return client_id


def _safe_spotify_auth_error(exc: BaseException) -> str:
    """Map Hermes' shaped errors to UI instructions without exposing OAuth details."""
    code = str(getattr(exc, "code", ""))
    if code == "spotify_callback_timeout":
        return "Spotify authorization timed out. Select Connect Spotify to retry."
    if code == "spotify_callback_bind_failed":
        return "Spotify could not start its local callback. Check the redirect URI and retry."
    if code == "spotify_client_id_missing":
        return "A Spotify Client ID is needed for one-time setup before connecting."
    return "Spotify authorization did not complete. Select Connect Spotify to retry."


def _spotify_setup_data(auth: Mapping[str, Any]) -> dict[str, Any]:
    """Describe only the one-time public setup Hermes requires before PKCE can start."""
    configured_client_id = auth.get("client_id")
    if not configured_client_id:
        try:
            configured_client_id = _configured_spotify_client_id()
        except Exception:  # noqa: BLE001 - missing configuration is an expected setup state.
            configured_client_id = None
    return {
        "client_id_required": not bool(configured_client_id),
        "redirect_uri": _spotify_redirect_uri(),
        "developer_dashboard_url": SPOTIFY_DASHBOARD_URL,
    }


def _run_spotify_auth(client_id: str | None) -> None:
    """Run Hermes' PKCE flow in a daemon so API requests never wait for callback."""
    global _client
    try:
        login_spotify_command(SimpleNamespace(
            client_id=client_id,
            redirect_uri=None,
            scope=None,
            no_browser=False,
            timeout=180,
        ))
    except (Exception, SystemExit) as exc:  # noqa: BLE001 - Hermes reports cancelled OAuth flows through SystemExit.
        # OAuth exceptions can contain an authorization URL, client ID, or token response.
        logger.warning("Spotify authentication flow did not complete")
        with _spotify_auth_lock:
            _spotify_auth_flow.update(state="failed", error=_safe_spotify_auth_error(exc))
    else:
        with _spotify_auth_lock:
            _spotify_auth_flow.update(state="succeeded", error=None)
    finally:
        # The next provider request must resolve credentials freshly from Hermes' auth store.
        _client = None


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = float(value)
        if not math.isfinite(number):
            return default
        return max(minimum, min(maximum, int(number)))
    except (TypeError, ValueError, OverflowError):
        return default


def _strict_bounded_int(value: Any, minimum: int, maximum: int, field: str) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{field} must be a number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return max(minimum, min(maximum, int(number)))


def _plugin_settings() -> dict[str, Any]:
    """Return validated plugin settings without ever mutating Hermes config cache."""
    merged = dict(_DEFAULT_SETTINGS)
    try:
        from hermes_cli.config import load_config_readonly
        try:
            from hermes_cli.plugins_state import _plugin_settings_entry
        except ImportError:  # Compatibility with older Hermes installations.
            from hermes_cli.plugins import _plugin_settings_entry

        entry = _plugin_settings_entry(load_config_readonly() or {}, PLUGIN_NAME) or {}
        settings = entry.get("settings") or {}
        if isinstance(settings, Mapping):
            merged["poll_interval_open"] = _bounded_int(settings.get("poll_interval_open"), 8, 8, 60)
            merged["poll_interval_closed"] = _bounded_int(settings.get("poll_interval_closed"), 20, 20, 300)
            merged["radio_search_limit"] = _bounded_int(settings.get("radio_search_limit"), 20, 1, _MAX_RADIO_LIMIT)
    except Exception as exc:  # noqa: BLE001 - optional host settings must never disable controls.
        logger.debug("FluidMusic settings unavailable; using defaults: %s", exc)
    return merged


def _capabilities() -> dict[str, Any]:
    return {
        "spotify_connect": {"available": True, "auth": "hermes_auth_spotify"},
        "radio_browser": {"available": True, "stream_policy": "https-only-no-hls"},
    }


async def _call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run synchronous Spotify work off the event loop with stable public errors."""
    try:
        data = await anyio.to_thread.run_sync(lambda: fn(*args, **kwargs))
        return {"ok": True, "data": data}
    except SpotifyError as exc:
        response: dict[str, Any] = _error(str(exc))
        status_code = getattr(exc, "status_code", None)
        if status_code is not None:
            response["status_code"] = status_code
        return response
    except (httpx.HTTPError, OSError, TimeoutError):
        return _error("Spotify request failed")
    except (TypeError, ValueError) as exc:
        return _error(str(exc))


def _spotify_client() -> SpotifyClient:
    """Resolve Spotify only for a Spotify request, allowing authentication later."""
    global _client
    if _client is None:
        _client = SpotifyClient()
    return _client


def _spotify_request(method: str, path: str, **kwargs: Any) -> Any:
    return _spotify_client().request(method, path, **kwargs)


def _spotify_playback_state() -> Any:
    return _spotify_client().get_playback_state()


async def _payload(request: Request) -> dict[str, Any]:
    """Merge query parameters with a JSON object; JSON values take precedence."""
    payload: dict[str, Any] = dict(request.query_params)
    try:
        body = await request.json()
        if isinstance(body, dict):
            payload.update(body)
    except (OSError, ValueError):
        # Missing or malformed optional JSON body leaves query parameters intact.
        return payload
    return payload


def _device_params(payload: Mapping[str, Any]) -> dict[str, str] | None:
    device_id = str(payload.get("device_id") or "").strip()
    if not device_id:
        return None
    if len(device_id) > _MAX_DEVICE_ID_LENGTH:
        raise ValueError(f"device_id must be at most {_MAX_DEVICE_ID_LENGTH} characters")
    return {"device_id": device_id}


def _spotify_uri(value: Any, field: str = "uri") -> str:
    uri = str(value or "").strip()
    if not uri:
        raise ValueError(f"{field} is required")
    if len(uri) > _MAX_SPOTIFY_URI_LENGTH:
        raise ValueError(f"{field} must be at most {_MAX_SPOTIFY_URI_LENGTH} characters")
    if not uri.startswith("spotify:"):
        raise ValueError(f"{field} must be a Spotify URI")
    return uri


def _spotify_search_query(q: Any) -> str:
    query = str(q or "").strip()
    if not query:
        raise ValueError("q is required")
    if len(query) > _MAX_QUERY_LENGTH:
        raise ValueError(f"q must be at most {_MAX_QUERY_LENGTH} characters")
    return query


def _spotify_id(value: Any, field: str) -> str:
    spotify_id = str(value or "").strip()
    if not _SPOTIFY_ID_RE.fullmatch(spotify_id):
        raise ValueError(f"{field} must be a valid Spotify ID")
    return spotify_id


def _spotify_search_types(value: Any) -> str:
    allowed = {"album", "artist", "playlist", "track", "show", "episode", "audiobook"}
    requested = [part.strip() for part in str(value or "track").split(",") if part.strip()]
    if not requested or len(requested) > len(allowed) or any(part not in allowed for part in requested):
        raise ValueError("type contains an unsupported Spotify search type")
    return ",".join(dict.fromkeys(requested))


@router.get("/config")
async def get_config() -> dict[str, Any]:
    data = _plugin_settings()
    data["capabilities"] = _capabilities()
    return {"ok": True, "data": data}


@router.get("/spotify/auth/status")
async def spotify_auth_status() -> dict[str, Any]:
    """Expose safe Hermes Spotify metadata plus the local PKCE-flow state."""
    flow = _spotify_auth_flow_status()
    try:
        auth = _spotify_auth_status_data()
        setup = _spotify_setup_data(auth)
    except Exception:  # noqa: BLE001 - auth-store errors must not leak through the UI.
        return {"ok": False, "error": "Spotify authentication status unavailable", "data": {"flow": flow}}
    return {"ok": True, "data": {"auth": auth, "setup": setup, "flow": flow}}


@router.post("/spotify/auth/start")
async def spotify_auth_start(request: Request) -> dict[str, Any]:
    """Start one Hermes-managed browser PKCE flow without exposing its credentials."""
    try:
        client_id = _spotify_client_id((await _payload(request)).get("client_id"))
    except (TypeError, ValueError) as exc:
        return _error(str(exc))

    with _spotify_auth_lock:
        if _spotify_auth_flow["state"] == "in_progress":
            return _error("Spotify authentication is already in progress")
        try:
            setup = _spotify_setup_data(_spotify_auth_status_data())
        except Exception:  # noqa: BLE001 - do not expose auth-store failure details.
            return _error("Spotify authentication status unavailable")
        if setup["client_id_required"] and client_id is None:
            return _error("A public Spotify Client ID is needed for one-time setup. Use the setup details, then Connect Spotify.")
        # A reconnect deliberately lets Hermes resolve its existing configured ID.
        worker_client_id = client_id if setup["client_id_required"] else None
        _spotify_auth_flow.update(state="in_progress", error=None)
        worker = threading.Thread(
            target=_run_spotify_auth,
            args=(worker_client_id,),
            daemon=True,
            name="fluid-music-spotify-auth",
        )
        try:
            worker.start()
        except RuntimeError:
            _spotify_auth_flow.update(state="failed", error=_SPOTIFY_AUTH_ERROR)
            return _error(_SPOTIFY_AUTH_ERROR)
    return {"ok": True, "data": {"flow": _spotify_auth_flow_status()}}


@router.get("/player")
async def player() -> dict[str, Any]:
    result = await _call(_spotify_playback_state)
    result["settings"] = _plugin_settings()
    return result


@router.get("/devices")
async def devices() -> dict[str, Any]:
    result = await _call(_spotify_request, "GET", "/me/player/devices")
    devices = ((result.get("data") or {}).get("devices") or []) if result.get("ok") else []
    if devices:
        return result

    # Only a successful empty response (or Spotify's established no-device 410)
    # can be supplemented from current playback. Retrying a failed request here
    # obscures its auth/API error and duplicates an already-failed Spotify call.
    if not result.get("ok") and result.get("status_code") != 410:
        return result

    # Spotify can report no available devices while the playback-state
    # response still exposes the currently active Connect device.
    player_result = await _call(_spotify_playback_state)
    if player_result.get("ok"):
        device = (player_result.get("data") or {}).get("device") or {}
        if device.get("id"):
            return {"ok": True, "data": {"devices": [dict(device, is_active=True)]}}

    if result.get("status_code") == 410:
        return {"ok": True, "data": {"devices": []}}
    return result


@router.post("/play")
async def play(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        body: dict[str, Any] = {}
        if payload.get("context_uri"):
            body["context_uri"] = _spotify_uri(payload["context_uri"], "context_uri")
        if payload.get("uri"):
            body["uris"] = [_spotify_uri(payload["uri"])]
        if payload.get("uris"):
            values = payload["uris"]
            if not isinstance(values, (list, tuple)):
                raise ValueError("uris must be a list of Spotify URIs")
            if not values or len(values) > 50:
                raise ValueError("uris must contain 1 to 50 Spotify URIs")
            body["uris"] = [_spotify_uri(value, "uris") for value in values]
        if payload.get("position_ms") not in (None, ""):
            body["position_ms"] = _strict_bounded_int(payload["position_ms"], 0, 86_400_000, "position_ms")
        if payload.get("offset") not in (None, ""):
            offset = payload["offset"]
            body["offset"] = {"uri": _spotify_uri(offset, "offset")} if isinstance(offset, str) and offset.startswith("spotify:") else {"position": _strict_bounded_int(offset, 0, 10_000, "offset")}
        return await _call(_spotify_request, "PUT", "/me/player/play", params=_device_params(payload), json_body=body or None)
    except (TypeError, ValueError) as exc:
        return _error(str(exc))


@router.post("/pause")
async def pause(request: Request) -> dict[str, Any]:
    try:
        return await _call(_spotify_request, "PUT", "/me/player/pause", params=_device_params(await _payload(request)))
    except ValueError as exc:
        return _error(str(exc))


@router.post("/next")
async def next_track(request: Request) -> dict[str, Any]:
    try:
        return await _call(_spotify_request, "POST", "/me/player/next", params=_device_params(await _payload(request)))
    except ValueError as exc:
        return _error(str(exc))


@router.post("/previous")
async def previous_track(request: Request) -> dict[str, Any]:
    try:
        return await _call(_spotify_request, "POST", "/me/player/previous", params=_device_params(await _payload(request)))
    except ValueError as exc:
        return _error(str(exc))


@router.put("/volume")
async def volume(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        value = payload.get("volume_percent")
        if value in (None, ""):
            raise ValueError("volume_percent is required")
        percent = _strict_bounded_int(value, 0, 100, "volume_percent")
        return await _call(_spotify_request, "PUT", "/me/player/volume", params={"volume_percent": percent, **(_device_params(payload) or {})})
    except ValueError as exc:
        return _error(str(exc))


@router.put("/seek")
async def seek(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        if payload.get("position_ms") in (None, ""):
            raise ValueError("position_ms is required")
        position_ms = _strict_bounded_int(payload["position_ms"], 0, 86_400_000, "position_ms")
        return await _call(
            _spotify_request,
            "PUT",
            "/me/player/seek",
            params={"position_ms": position_ms, **(_device_params(payload) or {})},
        )
    except ValueError as exc:
        return _error(str(exc))


@router.put("/transfer")
async def transfer(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        device_id = (_device_params(payload) or {}).get("device_id")
        if not device_id:
            return _error("device_id is required")
        raw_play = str(payload.get("play", "true")).lower()
        if raw_play not in {"1", "0", "true", "false", "yes", "no", "on", "off"}:
            return _error("play must be a boolean")
        return await _call(_spotify_request, "PUT", "/me/player", json_body={"device_ids": [device_id], "play": raw_play in {"1", "true", "yes", "on"}})
    except ValueError as exc:
        return _error(str(exc))


@router.get("/queue")
async def queue() -> dict[str, Any]:
    return await _call(_spotify_request, "GET", "/me/player/queue")


@router.post("/queue")
async def queue_add(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        return await _call(_spotify_request, "POST", "/me/player/queue", params={"uri": _spotify_uri(payload.get("uri")), **(_device_params(payload) or {})})
    except ValueError as exc:
        return _error(str(exc))


@router.put("/shuffle")
async def shuffle(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        raw = str(payload.get("state", "")).lower()
        if raw not in {"1", "0", "true", "false", "yes", "no", "on", "off"}:
            return _error("state must be a boolean")
        return await _call(_spotify_request, "PUT", "/me/player/shuffle", params={"state": "true" if raw in {"1", "true", "yes", "on"} else "false", **(_device_params(payload) or {})})
    except ValueError as exc:
        return _error(str(exc))


@router.put("/repeat")
async def repeat(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        state = str(payload.get("state", "off"))
        if state not in {"off", "context", "track"}:
            return _error("state must be one of off/context/track")
        return await _call(_spotify_request, "PUT", "/me/player/repeat", params={"state": state, **(_device_params(payload) or {})})
    except ValueError as exc:
        return _error(str(exc))


@router.get("/search")
async def search(q: str, type: str = "track", limit: int = 8, offset: int = 0) -> dict[str, Any]:
    try:
        return await _call(
            _spotify_request,
            "GET",
            "/search",
            params={
                "q": _spotify_search_query(q),
                "type": _spotify_search_types(type),
                "limit": _bounded_int(limit, 8, 1, 10),
                "offset": _bounded_int(offset, 0, 0, 1_000),
            },
        )
    except ValueError as exc:
        return _error(str(exc))


@router.get("/playlists")
async def playlists(limit: int = 20, offset: int = 0) -> dict[str, Any]:
    return await _call(
        _spotify_request,
        "GET",
        "/me/playlists",
        params={"limit": _bounded_int(limit, 20, 1, 50), "offset": _bounded_int(offset, 0, 0, 100_000)},
    )


@router.get("/playlists/{playlist_id}/tracks")
async def playlist_tracks(playlist_id: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    try:
        safe_id = _spotify_id(playlist_id, "playlist_id")
        return await _call(
            _spotify_request,
            "GET",
            f"/playlists/{safe_id}/items",
            params={"limit": _bounded_int(limit, 50, 1, 50), "offset": _bounded_int(offset, 0, 0, 100_000)},
        )
    except ValueError as exc:
        return _error(str(exc))


def _local_library() -> Any:
    """Resolve the profile-scoped database path at request time."""
    return LocalLibrary()


@router.get("/local/roots")
async def local_roots() -> dict[str, Any]:
    try:
        roots = await anyio.to_thread.run_sync(lambda: _local_library().list_roots())
        return {"ok": True, "data": {"roots": roots}}
    except (OSError, ValueError, RuntimeError, sqlite3.Error):
        return _error("Local music library could not be opened")


@router.post("/local/roots")
async def local_root_add(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        result = await anyio.to_thread.run_sync(lambda: _local_library().add_root(payload.get("path")))
        return {"ok": True, "data": result}
    except ValueError as exc:
        return _error(str(exc))
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Local music folder could not be indexed")


@router.delete("/local/roots/{root_id}")
async def local_root_remove(root_id: str) -> dict[str, Any]:
    try:
        removed = await anyio.to_thread.run_sync(lambda: _local_library().remove_root(root_id))
        if not removed:
            return _error("scan root was not found")
        return {"ok": True, "data": {"removed": True}}
    except ValueError as exc:
        return _error(str(exc))
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Local music folder could not be removed")


@router.post("/local/rescan")
async def local_rescan(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        root_id = payload.get("root_id") or None
        result = await anyio.to_thread.run_sync(lambda: _local_library().scan(root_id))
        return {"ok": True, "data": result}
    except ValueError as exc:
        return _error(str(exc))
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Local music library could not be rescanned")


@router.get("/local/tracks")
async def local_tracks(
    root_id: str | None = None,
    include_missing: bool = True,
    limit: int = 2_000,
    offset: int = 0,
) -> dict[str, Any]:
    try:
        result = await anyio.to_thread.run_sync(
            lambda: _local_library().list_tracks(
                root_id=root_id,
                include_missing=include_missing,
                limit=_bounded_int(limit, 2_000, 1, 5_000),
                offset=_bounded_int(offset, 0, 0, 1_000_000),
            )
        )
        return {"ok": True, "data": result}
    except ValueError as exc:
        return _error(str(exc))
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Local music library could not be loaded")


@router.get("/local/tracks/{track_id}")
async def local_track(track_id: str) -> dict[str, Any]:
    try:
        track = await anyio.to_thread.run_sync(lambda: _local_library().get_track(track_id))
        return {"ok": True, "data": {"track": track}}
    except ValueError as exc:
        return _error(str(exc))
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Local track could not be loaded")


def _is_public_https_url(value: Any) -> bool:
    """Accept only normal public HTTPS URLs; stream hosts are never backend-proxied."""
    if not isinstance(value, str) or len(value) > 2_048 or any(char.isspace() for char in value):
        return False
    parsed = urlparse(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        return False
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local") or "." not in hostname:
        return False
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return True
    return address.is_global


def _is_hls(station: Mapping[str, Any], stream_url: str) -> bool:
    tags = str(station.get("tags") or "").lower()
    codec = str(station.get("codec") or "").lower()
    path = urlparse(stream_url).path.lower()
    return bool(station.get("hls")) or "hls" in tags.split(",") or codec == "hls" or path.endswith(".m3u8")


def _station_from_directory(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, Mapping):
        return None
    try:
        station_id = str(uuid.UUID(str(item.get("stationuuid") or "")))
    except (ValueError, AttributeError):
        return None
    name = str(item.get("name") or "").strip()
    stream_url = str(item.get("url_resolved") or item.get("url") or "").strip()
    if not name or len(name) > 200 or not _is_public_https_url(stream_url) or _is_hls(item, stream_url):
        return None
    result: dict[str, Any] = {"stationuuid": station_id, "name": name, "url": stream_url}
    for key in ("tags", "country", "language", "codec", "bitrate", "votes"):
        value = item.get(key)
        if value not in (None, ""):
            result[key] = value
    for key in ("homepage", "favicon"):
        value = item.get(key)
        if _is_public_https_url(value):
            result[key] = value
    return result


def _radio_get(url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
    """One controlled request to a fixed Radio Browser HTTPS endpoint."""
    return httpx.get(
        url,
        params=params,
        headers={"User-Agent": RADIO_BROWSER_USER_AGENT, "Accept": "application/json"},
        timeout=8.0,
        follow_redirects=False,
    )


@router.get("/radio/search")
async def radio_search(q: str, limit: int = 20) -> dict[str, Any]:
    try:
        query = _spotify_search_query(q)
        bounded_limit = _bounded_int(limit, 20, 1, _MAX_RADIO_LIMIT)
        response = await anyio.to_thread.run_sync(
            lambda: _radio_get(
                RADIO_BROWSER_SEARCH_URL,
                params={
                    "name": query,
                    "limit": bounded_limit,
                    "hidebroken": "true",
                    "order": "votes",
                    "reverse": "true",
                },
            )
        )
        if response.status_code >= 400:
            return _error(f"Radio Browser directory returned HTTP {response.status_code}")
        payload = response.json()
        if not isinstance(payload, list):
            return _error("Radio Browser directory returned an invalid response")
        stations = [station for station in (_station_from_directory(item) for item in payload) if station is not None]
        return {"ok": True, "data": {"stations": stations[:bounded_limit]}}
    except httpx.HTTPError:
        return _error("Radio Browser search failed")
    except ValueError as exc:
        return _error(f"Radio Browser search failed: {exc}")


@router.post("/radio/click/{stationuuid}")
async def radio_click(stationuuid: str) -> dict[str, Any]:
    try:
        canonical_id = str(uuid.UUID(stationuuid))
    except (ValueError, AttributeError):
        return _error("stationuuid must be a UUID")
    try:
        # Never proxy the 302 stream response: its destination is untrusted input.
        response = await anyio.to_thread.run_sync(
            lambda: _radio_get(f"{RADIO_BROWSER_CLICK_BASE_URL}/{canonical_id}")
        )
        if response.status_code >= 400:
            return _error(f"Radio Browser click registration returned HTTP {response.status_code}")
        return {"ok": True, "data": {"stationuuid": canonical_id, "clicked": True}}
    except httpx.HTTPError:
        return _error("Radio Browser click registration failed")
