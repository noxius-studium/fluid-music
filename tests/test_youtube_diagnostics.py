"""YouTube provider-failure diagnostic shape fixtures (FM-07).

Labelled cloud fixtures: yt-dlp extraction is replaced by fakes raising
labelled provider signals; NO live YouTube request is made. Classification
uses ONLY explicit provider signals — anything else stays 'undetermined',
never a catch-all unavailable label. Real failed-video classification needs
owner-side runtime evidence (FM-25 gate).
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import types
from pathlib import Path
from typing import Any

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
    yield module
    sys.modules.pop("dashboard.plugin_api", None)


def run(awaitable: Any) -> Any:
    return asyncio.run(awaitable)


async def request(api: Any, method: str, path: str, **kwargs: Any) -> httpx.Response:
    app = FastAPI()
    app.include_router(api.router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


@pytest.mark.parametrize(
    ("signal", "expected_code"),
    [
        ("ERROR: Private video. Sign in if you've been granted access to this video", "private-video"),
        ("ERROR: Video unavailable. This video has been removed by the uploader", "content-unavailable"),
        ("ERROR: Sign in to confirm your age. This video may be inappropriate for some users.", "consent-required"),
        ("ERROR: HTTP Error 429: Too Many Requests", "rate-limited"),
        ("ERROR: unable to download video data: <urlopen error timed out>", "network-error"),
        ("ERROR: something completely different happened", "undetermined"),
    ],
)
def test_resolve_classifies_explicit_provider_signals_only(api: Any, monkeypatch: pytest.MonkeyPatch, signal: str, expected_code: str):
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(signal)

    monkeypatch.setattr(api, "_youtube_extract", boom)
    response = run(request(api, "POST", "/youtube/resolve", json={"url": "https://youtu.be/abcdefghijk"}))
    body = response.json()
    assert body["ok"] is False
    assert body["error_code"] == expected_code
    assert isinstance(body["error"], str) and body["error"]
    # Sanitized: no raw provider text, internals or credentials leak.
    assert signal not in response.text
    assert "Traceback" not in response.text


def test_search_classifies_the_same_signals(api: Any, monkeypatch: pytest.MonkeyPatch):
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("ERROR: HTTP Error 429: Too Many Requests")

    monkeypatch.setattr(api, "_youtube_extract", boom)
    body = run(request(api, "GET", "/youtube/search?q=night")).json()
    assert body["ok"] is False
    assert body["error_code"] == "rate-limited"


def test_undetermined_is_not_labelled_unavailable(api: Any, monkeypatch: pytest.MonkeyPatch):
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("ERROR: iframe did not start for an unknown reason")

    monkeypatch.setattr(api, "_youtube_extract", boom)
    body = run(request(api, "POST", "/youtube/resolve", json={"url": "https://youtu.be/abcdefghijk"})).json()
    assert body["error_code"] == "undetermined"
    assert "unavailable" not in body["error"].lower()
    assert "private" not in body["error"].lower()
    assert "removed" not in body["error"].lower()


def test_private_signal_wins_over_generic_unavailable_text(api: Any, monkeypatch: pytest.MonkeyPatch):
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("ERROR: Video unavailable: Private video")

    monkeypatch.setattr(api, "_youtube_extract", boom)
    body = run(request(api, "POST", "/youtube/resolve", json={"url": "https://youtu.be/abcdefghijk"})).json()
    assert body["error_code"] == "private-video"


def test_successful_path_shape_is_unchanged(api: Any, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api, "_youtube_extract", lambda *_a, **_k: {
        "id": "abcdefghijk", "title": "Working video", "uploader": "Channel", "duration": 60,
        "thumbnail": "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    })
    body = run(request(api, "POST", "/youtube/resolve", json={"url": "https://youtu.be/abcdefghijk"})).json()
    assert body["ok"] is True
    assert "error_code" not in body
    assert body["data"]["item"]["title"] == "Working video"
