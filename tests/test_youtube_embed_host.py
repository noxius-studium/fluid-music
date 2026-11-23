"""Loopback YouTube embed-host contract fixtures (FM-04).

Labelled cloud fixtures: one bounded ephemeral 127.0.0.1 HTTP server owned by
the test and torn down explicitly. These prove the wrapper's request/message
contract only — NOT real YouTube playback, embed consent, or audible video
(owner Desktop acceptance, FM-25). The loopback URL is also unreachable from
the owner's Desktop when this backend runs on a remote cloud host; that
cross-host limitation remains explicit and is not "fixed" by exposing 0.0.0.0.
"""

from __future__ import annotations

import asyncio
import importlib
import re
import sys
import types
from pathlib import Path
from typing import Any

import httpx
import pytest


@pytest.fixture
def embed_api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    sys.modules.pop("dashboard.plugin_api", None)
    module = importlib.import_module("dashboard.plugin_api")
    yield module
    # Own the server lifecycle: stop it even if a test fails mid-request.
    if module._youtube_embed_server is not None:
        module._youtube_embed_server.shutdown()
        module._youtube_embed_server.server_close()
        module._youtube_embed_server = None
        module._youtube_embed_origin = ""
        module._youtube_embed_token = ""
    sys.modules.pop("dashboard.plugin_api", None)


def run(awaitable: Any) -> Any:
    return asyncio.run(awaitable)


async def get(url: str, headers: dict[str, str] | None = None) -> httpx.Response:
    async with httpx.AsyncClient() as client:
        return await client.get(url, headers=headers or {})


def test_embed_host_binds_loopback_only_and_serves_the_exact_capability_path(embed_api: Any):
    origin, token = embed_api._ensure_youtube_embed_host()
    assert origin.startswith("http://127.0.0.1:")
    assert embed_api._youtube_embed_server.server_address[0] == "127.0.0.1"
    assert len(token) >= 24

    response = run(get(f"{origin}/{token}/youtube/abcdefghijk?controls=1&enablejsapi=1"))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "frame-src https://www.youtube-nocookie.com" in response.headers["content-security-policy"]
    body = response.text
    assert "https://www.youtube-nocookie.com/embed/abcdefghijk" in body
    assert 'referrerpolicy="strict-origin-when-cross-origin"' in body


@pytest.mark.parametrize(
    "path_suffix",
    [
        "/wrong-token/youtube/abcdefghijk",
        "/{token}/youtube/short",
        "/{token}/youtube/abcdefghijk-extra",
        "/{token}/other/abcdefghijk",
        "/{token}/youtube/abcdefghijk/../../secret",
    ],
)
def test_embed_host_rejects_wrong_token_path_or_video(embed_api: Any, path_suffix: str):
    origin, token = embed_api._ensure_youtube_embed_host()
    url = f"{origin}{path_suffix.format(token=token)}"
    response = run(get(url))
    assert response.status_code == 404


def test_embed_host_rejects_foreign_host_header(embed_api: Any):
    origin, token = embed_api._ensure_youtube_embed_host()
    response = run(get(f"{origin}/{token}/youtube/abcdefghijk", headers={"Host": "evil.example"}))
    assert response.status_code == 404


def test_embed_relay_is_origin_bound_and_schema_validated(embed_api: Any):
    origin, token = embed_api._ensure_youtube_embed_host()
    body = run(get(f"{origin}/{token}/youtube/abcdefghijk")).text
    script = re.search(r"<script>(.*)</script>", body, re.DOTALL)
    assert script, "relay script present"
    relay = script.group(1)
    # Parent-bound forwarding: the wrapper derives the embedding origin from
    # its referrer and validates incoming origins instead of trusting source.
    assert "document.referrer" in relay
    assert "event.origin" in relay
    assert "parent.postMessage(event.data,'*')" not in relay, "no unconditional wildcard forwarding to the parent"
    # Commands toward the player are schema/channel validated and targeted.
    assert "fluid-music" in relay
    assert "'https://www.youtube-nocookie.com'" in relay
    assert "JSON.parse" in relay


def test_embed_host_route_validates_video_id_before_starting_a_server(embed_api: Any):
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(embed_api.router)

    async def call(video_id: str) -> Any:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(f"/youtube/embed-host?video_id={video_id}")

    bad = run(call("not-an-id"))
    assert bad.json()["ok"] is False
    assert embed_api._youtube_embed_server is None, "invalid input never starts the server"
    good = run(call("abcdefghijk"))
    assert good.json()["ok"] is True
    assert good.json()["data"]["url"].startswith("http://127.0.0.1:")
