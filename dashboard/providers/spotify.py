"""FluidMusic-owned Spotify provider: official Authorization Code + PKCE.

This module owns the entire Spotify integration for FluidMusic. It never
imports a Hermes-core or sibling-plugin Spotify implementation, never handles
another plugin's credentials, and never logs tokens or authorization URLs.

Flow: S256 PKCE against accounts.spotify.com with a random state bound to a
loopback-only callback; tokens are stored in the protected profile-local
store; API requests carry a single 401 retry behind a single-flight refresh;
logout revokes best-effort and always removes local credentials. Missing
login is an honest disconnected state — never a fake Connected.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import logging
import secrets
import threading
import time
import webbrowser
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from . import token_store

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
REVOKE_URL = "https://accounts.spotify.com/api/token"
API_BASE_URL = "https://api.spotify.com/v1"
DASHBOARD_URL = "https://developer.spotify.com/dashboard"
REDIRECT_PORT = 43827
REDIRECT_PATH = "/spotify/callback"
SCOPES = (
    "user-read-playback-state user-modify-playback-state user-read-currently-playing "
    "user-library-read playlist-read-private playlist-read-collaborative streaming user-read-email user-read-private"
)
_HTTP_TIMEOUT = 15.0


class SpotifyError(RuntimeError):
    """Sanitized provider error; ``status_code`` mirrors Spotify HTTP status."""

    def __init__(self, message: str, status_code: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def redirect_uri() -> str:
    return f"http://127.0.0.1:{REDIRECT_PORT}{REDIRECT_PATH}"


def configured_client_id() -> str | None:
    data = token_store.load()
    client_id = str(data.get("client_id") or "").strip()
    return client_id or None


def auth_status() -> dict[str, Any]:
    """UI-safe metadata only — raw tokens never leave this module."""
    data = token_store.load()
    if not data.get("access_token") and not data.get("refresh_token"):
        return {"logged_in": False}
    return {
        "logged_in": True,
        "auth_type": "oauth_pkce",
        "client_id": str(data.get("client_id") or ""),
        "redirect_uri": redirect_uri(),
        "scope": str(data.get("scope") or ""),
        "expires_at": str(data.get("expires_at") or ""),
        "api_base_url": API_BASE_URL,
        "has_refresh_token": bool(data.get("refresh_token")),
        "account": data.get("account") if isinstance(data.get("account"), dict) else {},
    }


def _new_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    if len(verifier) < 43:
        verifier = (verifier + secrets.token_urlsafe(32))[:128]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier[:128], challenge


def _authorize_url(client_id: str, state: str, challenge: str) -> str:
    query = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri(),
        "state": state,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "scope": SCOPES,
    })
    return f"{AUTHORIZE_URL}?{query}"


def _http(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(transport=transport, timeout=_HTTP_TIMEOUT, follow_redirects=False)


def _expires_at(expires_in: Any) -> str:
    seconds = max(60, int(expires_in or 3600))
    return (datetime.now(UTC) + timedelta(seconds=seconds - 30)).isoformat()


def _expired(data: dict[str, Any]) -> bool:
    raw = str(data.get("expires_at") or "")
    try:
        return datetime.fromisoformat(raw) <= datetime.now(UTC)
    except ValueError:
        return True


def _store_tokens(payload: dict[str, Any], client_id: str | None, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    previous = previous or {}
    data = {
        "client_id": client_id or previous.get("client_id") or "",
        "access_token": str(payload.get("access_token") or ""),
        "refresh_token": str(payload.get("refresh_token") or previous.get("refresh_token") or ""),
        "scope": str(payload.get("scope") or previous.get("scope") or ""),
        "expires_at": _expires_at(payload.get("expires_in")),
        "token_type": str(payload.get("token_type") or "Bearer"),
        "account": previous.get("account") if isinstance(previous.get("account"), dict) else {},
    }
    if not data["access_token"]:
        raise SpotifyError("Spotify did not return an access token.", code="spotify_token_invalid")
    token_store.save(data)
    return data


def _bind_account(data: dict[str, Any], transport: httpx.BaseTransport | None = None) -> None:
    try:
        with _http(transport) as client:
            response = client.get(f"{API_BASE_URL}/me", headers={"Authorization": f"Bearer {data['access_token']}"})
        if response.status_code == 200:
            profile = response.json()
            data["account"] = {
                "id": str(profile.get("id") or ""),
                "display_name": str(profile.get("display_name") or ""),
                "product": str(profile.get("product") or ""),
            }
            token_store.save(data)
    except (httpx.HTTPError, ValueError):
        logger.debug("Spotify account binding unavailable; metadata stays empty")


def _exchange_code(client_id: str, code: str, verifier: str, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    with _http(transport) as client:
        response = client.post(TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri(),
            "client_id": client_id,
            "code_verifier": verifier,
        })
    if response.status_code != 200:
        raise SpotifyError("Spotify sign-in could not be completed. Select Connect Spotify to retry.", code="spotify_exchange_failed")
    data = _store_tokens(response.json(), client_id)
    _bind_account(data, transport)
    return data


def _consume_callback(result: dict[str, Any], expected_state: str) -> str:
    if result.get("error"):
        raise SpotifyError("Spotify authorization was declined.", code="spotify_auth_declined")
    if result.get("state") != expected_state:
        raise SpotifyError("Spotify authorization state did not match. Select Connect Spotify to retry.", code="spotify_state_mismatch")
    code = str(result.get("code") or "")
    if not code:
        raise SpotifyError("Spotify authorization timed out. Select Connect Spotify to retry.", code="spotify_callback_timeout")
    return code


def login(args: Any) -> None:
    """Run the official PKCE flow; the API request thread never waits on it.

    The genuine provider page opens in the user's browser (official OAuth
    consent); the callback listener is loopback-only and single-use. No
    password is ever captured by FluidMusic.
    """
    client_id = str(getattr(args, "client_id", None) or configured_client_id() or "").strip()
    if not client_id:
        raise SpotifyError("A Spotify Client ID is needed for one-time setup before connecting.", code="spotify_client_id_missing")
    timeout = float(getattr(args, "timeout", 180) or 180)
    verifier, challenge = _new_pkce()
    state = secrets.token_urlsafe(32)
    result: dict[str, Any] = {}

    class _CallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # stdlib handler contract.
            parsed = urlparse(self.path)
            if parsed.path != REDIRECT_PATH:
                self.send_error(404)
                return
            if "code" in result or "error" in result:
                self.send_error(409)
                return
            params = parse_qs(parsed.query)
            for key in ("state", "code", "error"):
                if params.get(key):
                    result[key] = params[key][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b"<html><body><p>Spotify sign-in received. Return to FluidMusic; you can close this tab.</p></body></html>")

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    try:
        server = http.server.HTTPServer(("127.0.0.1", REDIRECT_PORT), _CallbackHandler)
    except OSError as exc:
        raise SpotifyError("Spotify could not start its local callback. Check the redirect URI and retry.", code="spotify_callback_bind_failed") from exc
    server.timeout = 1.0
    try:
        if not getattr(args, "no_browser", False):
            webbrowser.open(_authorize_url(client_id, state, challenge))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and "code" not in result and "error" not in result:
            server.handle_request()
    finally:
        server.server_close()
    code = _consume_callback(result, state)
    _exchange_code(client_id, code, verifier)


class SpotifyClient:
    """Official Web API client with single-flight refresh and one 401 retry."""

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport
        self._refresh_lock = threading.Lock()

    def _refresh(self, data: dict[str, Any]) -> str:
        refresh_token = str(data.get("refresh_token") or "")
        if not refresh_token:
            raise SpotifyError("Spotify is not connected. Connect Spotify in Settings.", status_code=401, code="spotify_not_connected")
        with _http(self._transport) as client:
            response = client.post(TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": str(data.get("client_id") or ""),
            })
        if response.status_code != 200:
            token_store.clear()
            raise SpotifyError("Spotify sign-in expired. Reconnect to continue.", status_code=401, code="spotify_refresh_failed")
        stored = _store_tokens(response.json(), str(data.get("client_id") or ""), previous=data)
        return stored["access_token"]

    def _refresh_single_flight(self, stale: dict[str, Any]) -> str:
        with self._refresh_lock:
            fresh = token_store.load()
            if fresh.get("access_token") and not _expired(fresh) and fresh.get("access_token") != stale.get("access_token"):
                return str(fresh["access_token"])
            return self._refresh(fresh or stale)

    def _access_token(self) -> str:
        data = token_store.load()
        token = str(data.get("access_token") or "")
        if not token and not data.get("refresh_token"):
            raise SpotifyError("Spotify is not connected. Connect Spotify in Settings.", status_code=401, code="spotify_not_connected")
        if not token or _expired(data):
            return self._refresh_single_flight(data)
        return token

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        token = self._access_token()
        with _http(self._transport) as client:
            response = client.request(
                method,
                f"{API_BASE_URL}{path}",
                headers={"Authorization": f"Bearer {token}"},
                params=kwargs.get("params"),
                json=kwargs.get("json_body"),
            )
            if response.status_code == 401:
                token = self._refresh_single_flight(token_store.load())
                response = client.request(
                    method,
                    f"{API_BASE_URL}{path}",
                    headers={"Authorization": f"Bearer {token}"},
                    params=kwargs.get("params"),
                    json=kwargs.get("json_body"),
                )
        if response.status_code == 204:
            return {}
        if response.status_code >= 400:
            raise SpotifyError(_safe_api_error(response), status_code=response.status_code)
        try:
            return response.json()
        except ValueError as exc:
            raise SpotifyError("Spotify returned an invalid response.") from exc

    def get_playback_state(self) -> Any:
        return self.request("GET", "/me/player")


def _safe_api_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
        message = str(payload.get("error", {}).get("message") or "")
    except (ValueError, AttributeError):
        message = ""
    message = message.strip()
    if not message or len(message) > 200 or "token" in message.lower():
        return "Spotify request failed"
    return message


def logout(transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Best-effort provider revoke, then ALWAYS remove local credentials."""
    data = token_store.load()
    refresh_token = str(data.get("refresh_token") or "")
    revoked = False
    if refresh_token:
        try:
            with _http(transport) as client:
                response = client.post(REVOKE_URL, data={
                    "token_type_hint": "refresh_token",
                    "token": refresh_token,
                    "client_id": str(data.get("client_id") or ""),
                })
            revoked = response.status_code == 200
        except httpx.HTTPError:
            revoked = False
    token_store.clear()
    return {"logged_in": False, "revoked": revoked}
