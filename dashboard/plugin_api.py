"""FluidMusic REST API: Spotify Connect, YouTube, radio and local-library routes.

The Spotify integration is OWNED by FluidMusic (dashboard/providers): official
Authorization Code + PKCE, protected profile-local credentials, single-flight
refresh.  No Hermes-core or sibling-plugin Spotify implementation is imported.
The integration is resolved lazily on the first Spotify-specific request; a
missing or broken provider reports an explicit unavailable state and never
aborts this module — YouTube, radio, local-library and history routes mount
independently.  Legacy credential stores stay untouched until an explicit
owner sign-in; missing login is never a fake Connected state.

Radio stream URLs are returned for the desktop's native player, not fetched by
this backend.  The only outbound Radio Browser requests target fixed HTTPS
endpoints, never follow redirects, and accept no caller-supplied URL.
"""

from __future__ import annotations

import importlib
import importlib.util
import html
import http.server
import ipaddress
import logging
import math
import re
import secrets
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

def _load_spotify_integration():
    """Load the FluidMusic-OWNED Spotify provider (no core/sibling imports)."""
    providers_root = Path(__file__).resolve().parent / "providers"
    package_name = "hermes_fluid_music_providers"
    if package_name not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            package_name,
            providers_root / "__init__.py",
            submodule_search_locations=[str(providers_root)],
        )
        if spec is None or spec.loader is None:
            raise ImportError("The FluidMusic Spotify provider package is unavailable")
        package = importlib.util.module_from_spec(spec)
        sys.modules[package_name] = package
        try:
            spec.loader.exec_module(package)
        except Exception:
            sys.modules.pop(package_name, None)
            raise
    spotify = importlib.import_module(f"{package_name}.spotify")
    return (
        spotify.SpotifyClient,
        spotify.SpotifyError,
        spotify.auth_status,
        spotify.login,
        spotify.configured_client_id,
        spotify.redirect_uri,
        spotify.DASHBOARD_URL,
    )


# Optional-provider boundary: these names stay None until the first
# Spotify-specific request resolves the integration.  Explicitly assigned
# values (for example test doubles) are never overwritten by the loader.
SpotifyClient: Any = None
SpotifyError: Any = None
get_spotify_auth_status: Any = None
login_spotify_command: Any = None
_configured_spotify_client_id: Any = None
_spotify_redirect_uri: Any = None
SPOTIFY_DASHBOARD_URL: Any = None

_SPOTIFY_INTEGRATION_NAMES = (
    "SpotifyClient",
    "SpotifyError",
    "get_spotify_auth_status",
    "login_spotify_command",
    "_configured_spotify_client_id",
    "_spotify_redirect_uri",
    "SPOTIFY_DASHBOARD_URL",
)
_spotify_integration_lock = threading.Lock()
_spotify_integration_ready = False
_spotify_integration_unavailable = False
_SPOTIFY_UNAVAILABLE_ERROR = "Spotify integration is unavailable in this Hermes installation"


class SpotifyIntegrationUnavailable(RuntimeError):
    """The optional Spotify integration could not be loaded; other sources work."""


def _resolve_spotify_integration() -> None:
    """Load the optional integration once; failure is isolated and sanitized."""
    global _spotify_integration_ready, _spotify_integration_unavailable
    with _spotify_integration_lock:
        if _spotify_integration_ready:
            return
        if _spotify_integration_unavailable:
            raise SpotifyIntegrationUnavailable(_SPOTIFY_UNAVAILABLE_ERROR)
        try:
            loaded = _load_spotify_integration()
        except Exception:  # an optional provider must never abort the backend.
            _spotify_integration_unavailable = True
            logger.warning("FluidMusic Spotify integration is unavailable; other sources remain active")
            logger.debug("Spotify integration load failure", exc_info=True)
            raise SpotifyIntegrationUnavailable(_SPOTIFY_UNAVAILABLE_ERROR) from None
        for name, value in zip(_SPOTIFY_INTEGRATION_NAMES, loaded):
            if globals()[name] is None:
                globals()[name] = value
        _spotify_integration_ready = True


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
_client: Any = None

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
_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_spotify_auth_lock = threading.Lock()
_spotify_auth_flow: dict[str, str | None] = {"state": "idle", "error": None}
_youtube_embed_lock = threading.Lock()
_youtube_embed_server: http.server.ThreadingHTTPServer | None = None
_youtube_embed_origin = ""
_youtube_embed_token = ""


class _YouTubeEmbedHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract.
        parsed = urlparse(self.path)
        match = re.fullmatch(rf"/{re.escape(_youtube_embed_token)}/youtube/([A-Za-z0-9_-]{{11}})", parsed.path)
        if not match or self.headers.get("Host") != urlparse(_youtube_embed_origin).netloc:
            self.send_error(404)
            return
        from urllib.parse import parse_qs, urlencode
        requested = parse_qs(parsed.query)
        params = {key: requested[key][0] for key in ("controls", "enablejsapi", "playsinline", "rel", "start") if requested.get(key) and requested[key][0].isdigit()}
        params["origin"] = _youtube_embed_origin
        player_url = f"https://www.youtube-nocookie.com/embed/{match.group(1)}?{urlencode(params)}"
        document = f'''<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,iframe{{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}}</style></head><body><iframe src="{html.escape(player_url, quote=True)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" title="YouTube player"></iframe><script>const frame=document.querySelector('iframe');const parentOrigin=(()=>{{try{{const referrer=new URL(document.referrer);return /^https?:$/.test(referrer.protocol)?referrer.origin:''}}catch{{return ''}}}})();const playerOrigins=new Set(['https://www.youtube-nocookie.com','https://www.youtube.com']);const commandFuncs=['playVideo','pauseVideo','seekTo','setVolume','mute','unMute','stopVideo'];const parse=value=>{{try{{return typeof value==='string'?JSON.parse(value):value}}catch{{return null}}}};addEventListener('message',event=>{{if(event.source===parent){{if(parentOrigin?event.origin!==parentOrigin:event.origin!=='null')return;const data=parse(event.data);if(!data||typeof data!=='object'||data.channel!=='fluid-music')return;if(data.event==='command'&&commandFuncs.includes(data.func)){{frame.contentWindow.postMessage(JSON.stringify(data),'https://www.youtube-nocookie.com')}}else if(data.event==='listening'){{frame.contentWindow.postMessage(JSON.stringify(data),'https://www.youtube-nocookie.com')}}}}else if(event.source===frame.contentWindow){{if(!playerOrigins.has(event.origin))return;const data=parse(event.data);if(!data||typeof data!=='object'||typeof data.event!=='string')return;parent.postMessage(JSON.stringify(data),parentOrigin||'*')}}}})</script></body></html>'''.encode("utf-8")
        self.send_response(200)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-src https://www.youtube-nocookie.com; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(document)))
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(document)


def _ensure_youtube_embed_host() -> tuple[str, str]:
    global _youtube_embed_server, _youtube_embed_origin, _youtube_embed_token
    with _youtube_embed_lock:
        if _youtube_embed_server is None:
            _youtube_embed_token = secrets.token_urlsafe(24)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _YouTubeEmbedHandler)
            server.daemon_threads = True
            _youtube_embed_server = server
            _youtube_embed_origin = f"http://127.0.0.1:{server.server_port}"
            threading.Thread(target=server.serve_forever, daemon=True, name="fluid-music-youtube-embed").start()
    return _youtube_embed_origin, _youtube_embed_token


def _error(message: str) -> dict[str, Any]:
    return {"ok": False, "error": message}


def _spotify_auth_flow_status() -> dict[str, str | None]:
    """Return the UI-safe state of this process's most recent auth attempt."""
    with _spotify_auth_lock:
        return dict(_spotify_auth_flow)


def _spotify_auth_status_data() -> dict[str, Any]:
    """Whitelist Hermes auth-store metadata that is safe for the renderer."""
    _resolve_spotify_integration()
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
        "account",
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
    _resolve_spotify_integration()
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
        _resolve_spotify_integration()
        login_spotify_command(SimpleNamespace(
            client_id=client_id,
            redirect_uri=None,
            scope=None,
            no_browser=False,
            timeout=180,
        ))
    except SpotifyIntegrationUnavailable:
        with _spotify_auth_lock:
            _spotify_auth_flow.update(state="failed", error=_SPOTIFY_UNAVAILABLE_ERROR)
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
    try:
        _resolve_spotify_integration()
        spotify_connect: dict[str, Any] = {"available": True, "auth": "plugin_owned_oauth_pkce"}
    except SpotifyIntegrationUnavailable:
        spotify_connect = {
            "available": False,
            "auth": "plugin_owned_oauth_pkce",
            "unavailable_reason": "spotify-integration-unavailable",
        }
    return {
        "spotify_connect": spotify_connect,
        "radio_browser": {"available": True, "stream_policy": "https-only-no-hls"},
    }


async def _call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run synchronous Spotify work off the event loop with stable public errors."""
    try:
        _resolve_spotify_integration()
    except SpotifyIntegrationUnavailable as exc:
        return _error(str(exc))
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


def _spotify_client() -> Any:
    """Resolve Spotify only for a Spotify request, allowing authentication later."""
    global _client
    _resolve_spotify_integration()
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
    except SpotifyIntegrationUnavailable as exc:
        return {"ok": False, "error": str(exc), "data": {"flow": flow}}
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
        except SpotifyIntegrationUnavailable as exc:
            return _error(str(exc))
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


@router.get("/spotify/local-capability")
async def spotify_local_capability() -> dict[str, Any]:
    """Honest in-plugin playback assessment inputs; never certifies local audio.

    The backend can only know the account product. SDK presence, encrypted
    media and actual decoded audio are runtime/owner-side evidence; Connect
    control availability is reported separately and is NOT local audio.
    """
    try:
        _resolve_spotify_integration()
    except SpotifyIntegrationUnavailable as exc:
        return _error(str(exc))
    try:
        status = get_spotify_auth_status()
    except Exception:  # noqa: BLE001 - auth-store errors stay sanitized.
        status = {}
    account = status.get("account") if isinstance(status, Mapping) else None
    product = str((account or {}).get("product") or "") or None
    return {
        "ok": True,
        "data": {
            "account_product": product,
            "sdk": "unverified",
            "encrypted_media": "unverified",
            "provider_approval": "unverified",
            "connect_control": True,
            "local_audio": "unverified",
        },
    }


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


def _youtube_watch_url(value: Any) -> str:
    raw = str(value or "").strip()
    if len(raw) > 2_048:
        raise ValueError("YouTube URL is too long")
    parsed = urlparse(raw)
    if parsed.username or parsed.password:
        raise ValueError("Paste a valid HTTPS YouTube watch URL")
    video_id = ""
    if parsed.scheme == "https" and parsed.hostname in {"www.youtube.com", "youtube.com", "m.youtube.com"} and parsed.path == "/watch":
        from urllib.parse import parse_qs
        video_id = str(parse_qs(parsed.query).get("v", [""])[0])
    elif parsed.scheme == "https" and parsed.hostname == "youtu.be" and parsed.path.count("/") == 1:
        video_id = parsed.path[1:]
    if not _YOUTUBE_ID_RE.fullmatch(video_id):
        raise ValueError("Paste a valid HTTPS YouTube watch URL")
    return f"https://www.youtube.com/watch?v={video_id}"


def _youtube_item(info: Any) -> dict[str, Any] | None:
    if not isinstance(info, Mapping):
        return None
    video_id = str(info.get("id") or "").strip()
    title = str(info.get("title") or "").strip()
    if not _YOUTUBE_ID_RE.fullmatch(video_id) or not title:
        return None
    artwork = str(info.get("thumbnail") or "").strip()
    if not artwork.startswith("https://"):
        artwork = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    duration = max(0, min(86_400, int(info.get("duration") or 0)))
    return {
        "id": f"youtube:{video_id}",
        "source": "youtube",
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "title": title[:300],
        "subtitle": str(info.get("uploader") or info.get("channel") or "YouTube")[:300],
        "artwork": artwork[:2_048],
        "durationMs": duration * 1_000,
    }


def _youtube_provider_error(exc: Exception) -> dict[str, str]:
    """Classify ONLY explicit provider signals; anything else stays undetermined.

    Never label an unknown failure removed/private/unavailable, and never echo
    raw provider text (it can contain URLs, IDs or account hints).
    """
    text = str(exc).lower()
    if "private video" in text:
        return {"error_code": "private-video", "error": "This video is private."}
    if "video unavailable" in text or "has been removed" in text or "no longer available" in text:
        return {"error_code": "content-unavailable", "error": "This video is unavailable."}
    if "sign in" in text or "age-restricted" in text or "age restricted" in text or "confirm your age" in text:
        return {"error_code": "consent-required", "error": "This video requires YouTube sign-in or age confirmation."}
    if "429" in text or "too many requests" in text or "quota" in text:
        return {"error_code": "rate-limited", "error": "YouTube is rate-limiting requests. Wait a moment and retry."}
    if "timed out" in text or "timeout" in text or "urlopen" in text or "connection" in text or "network" in text:
        return {"error_code": "network-error", "error": "YouTube could not be reached. Check the connection and retry."}
    return {"error_code": "undetermined", "error": "YouTube metadata could not be loaded."}


def _youtube_extract(target: str, *, flat: bool) -> Any:
    from yt_dlp import YoutubeDL
    options = {
        "extract_flat": "in_playlist" if flat else False,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "socket_timeout": 12,
    }
    with YoutubeDL(options) as client:
        return client.extract_info(target, download=False)


@router.get("/youtube/embed-host")
async def youtube_embed_host(video_id: str) -> dict[str, Any]:
    if not _YOUTUBE_ID_RE.fullmatch(str(video_id or "")):
        return _error("video_id must be an 11-character YouTube ID")
    try:
        origin, token = await anyio.to_thread.run_sync(_ensure_youtube_embed_host)
        from urllib.parse import urlencode
        query = urlencode({"controls": 1, "enablejsapi": 1, "playsinline": 1, "rel": 0})
        return {"ok": True, "data": {"url": f"{origin}/{token}/youtube/{video_id}?{query}"}}
    except OSError:
        return _error("FluidMusic could not start its YouTube player host")


@router.get("/youtube/search")
async def youtube_search(q: str, limit: int = 12) -> dict[str, Any]:
    try:
        query = _spotify_search_query(q)
        bounded_limit = _bounded_int(limit, 12, 1, 20)
        result = await anyio.to_thread.run_sync(lambda: _youtube_extract(f"ytsearch{bounded_limit}:{query}", flat=True))
        entries = result.get("entries", []) if isinstance(result, Mapping) else []
        items = [item for item in (_youtube_item(entry) for entry in entries) if item is not None]
        return {"ok": True, "data": {"items": items[:bounded_limit]}}
    except ValueError as exc:
        return _error(str(exc))
    except Exception as exc:  # noqa: BLE001 - yt-dlp provider failures are deliberately redacted.
        logger.warning("YouTube search failed", exc_info=True)
        return {"ok": False, **_youtube_provider_error(exc)}


@router.post("/youtube/resolve")
async def youtube_resolve(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        watch_url = _youtube_watch_url(payload.get("url"))
        result = await anyio.to_thread.run_sync(lambda: _youtube_extract(watch_url, flat=False))
        item = _youtube_item(result)
        if item is None:
            return _error("YouTube did not return playable video metadata")
        return {"ok": True, "data": {"item": item}}
    except ValueError as exc:
        return _error(str(exc))
    except Exception as exc:  # noqa: BLE001 - yt-dlp provider failures are deliberately redacted.
        logger.warning("YouTube metadata lookup failed", exc_info=True)
        return {"ok": False, **_youtube_provider_error(exc)}


@router.get("/history")
async def playback_history(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    try:
        result = await anyio.to_thread.run_sync(
            lambda: _local_library().list_history(
                limit=_bounded_int(limit, 100, 1, 500),
                offset=_bounded_int(offset, 0, 0, 1_000_000),
            )
        )
        return {"ok": True, "data": result}
    except (OSError, ValueError, RuntimeError, sqlite3.Error):
        return _error("Playback history could not be loaded")


@router.post("/history")
async def playback_history_add(request: Request) -> dict[str, Any]:
    try:
        payload = await _payload(request)
        entry = await anyio.to_thread.run_sync(lambda: _local_library().record_history(payload.get("item")))
        return {"ok": True, "data": {"entry": entry}}
    except ValueError as exc:
        return _error(str(exc))
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Playback history could not be updated")


@router.delete("/history")
async def playback_history_clear() -> dict[str, Any]:
    try:
        removed = await anyio.to_thread.run_sync(lambda: _local_library().clear_history())
        return {"ok": True, "data": {"removed": removed}}
    except (OSError, RuntimeError, sqlite3.Error):
        return _error("Playback history could not be cleared")


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
