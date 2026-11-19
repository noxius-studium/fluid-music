"""YouTube catalogue contract fixtures (FM-05): bounded search/resolve metadata.

Labelled cloud fixtures: yt-dlp extraction is replaced by bounded fakes; NO
live YouTube request is made. These prove request/response shaping and honest
failure states only — real search results, titles and playback remain owner
Desktop acceptance (FM-25). Deep quota/unavailable root-cause classification
is FM-07's recovery matrix, not invented here.
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


def entry(video_id: str = "abcdefghijk", **overrides: Any) -> dict[str, Any]:
    base = {
        "id": video_id,
        "title": "Night set — live",
        "uploader": "Night Channel",
        "duration": 3600,
        "thumbnail": "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    }
    base.update(overrides)
    return base


def test_search_returns_real_bounded_metadata(api: Any, monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    def fake_extract(target: str, *, flat: bool) -> Any:
        captured["target"] = target
        captured["flat"] = flat
        return {"entries": [entry(title="x" * 500, duration=999_999, thumbnail="http://insecure.example/a.jpg")]}

    monkeypatch.setattr(api, "_youtube_extract", fake_extract)
    body = run(request(api, "GET", "/youtube/search?q=night+set&limit=5")).json()
    assert body["ok"] is True
    assert captured == {"target": "ytsearch5:night set", "flat": True}
    item = body["data"]["items"][0]
    assert item["id"] == "youtube:abcdefghijk"
    assert item["source"] == "youtube"
    assert item["url"] == "https://www.youtube.com/watch?v=abcdefghijk"
    assert len(item["title"]) == 300, "titles are bounded, never invented"
    assert item["subtitle"] == "Night Channel"
    assert item["durationMs"] == 86_400_000, "duration is bounded"
    assert item["artwork"].startswith("https://"), "insecure artwork is replaced with the safe https default"


def test_search_drops_entries_without_real_identity(api: Any, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api, "_youtube_extract", lambda *_a, **_k: {"entries": [
        entry(),
        entry(video_id="short"),
        {"id": "lmnopqrstuv", "title": ""},
        {"id": "lmnopqrstuv"},
        "not-an-entry",
    ]})
    body = run(request(api, "GET", "/youtube/search?q=night")).json()
    assert body["ok"] is True
    assert [item["id"] for item in body["data"]["items"]] == ["youtube:abcdefghijk"]


def test_search_empty_result_is_an_honest_empty_not_an_error(api: Any, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api, "_youtube_extract", lambda *_a, **_k: {"entries": []})
    body = run(request(api, "GET", "/youtube/search?q=nothing+matches")).json()
    assert body == {"ok": True, "data": {"items": []}}


def test_search_provider_failure_is_sanitized(api: Any, monkeypatch: pytest.MonkeyPatch):
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("ExtractorError: quota exceeded https://internal.example/token secret")

    monkeypatch.setattr(api, "_youtube_extract", boom)
    response = run(request(api, "GET", "/youtube/search?q=night"))
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "YouTube search is temporarily unavailable"
    assert "secret" not in response.text
    assert "internal.example" not in response.text
    assert "Traceback" not in response.text


def test_search_bounds_query_and_limit(api: Any, monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    def fake_extract(target: str, *, flat: bool) -> Any:
        captured["target"] = target
        return {"entries": [entry(video_id=f"vid{i:08d}") for i in range(30)]}

    monkeypatch.setattr(api, "_youtube_extract", fake_extract)
    assert run(request(api, "GET", "/youtube/search?q=")).json()["ok"] is False
    assert run(request(api, "GET", f"/youtube/search?q={'x' * 201}")).json()["ok"] is False
    body = run(request(api, "GET", "/youtube/search?q=night&limit=999")).json()
    assert body["ok"] is True
    assert captured["target"].startswith("ytsearch20:"), "limit is bounded to 20"
    assert len(body["data"]["items"]) <= 20


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/abcdefghijk",
    "https://m.youtube.com/watch?v=abcdefghijk",
])
def test_resolve_supported_urls_return_the_real_item(api: Any, monkeypatch: pytest.MonkeyPatch, url: str):
    monkeypatch.setattr(api, "_youtube_extract", lambda target, *, flat: entry())
    body = run(request(api, "POST", "/youtube/resolve", json={"url": url})).json()
    assert body["ok"] is True
    assert body["data"]["item"]["id"] == "youtube:abcdefghijk"
    assert body["data"]["item"]["title"] == "Night set — live"


@pytest.mark.parametrize("url", [
    "http://www.youtube.com/watch?v=abcdefghijk",
    "https://user:pass@www.youtube.com/watch?v=abcdefghijk",
    "https://youtube.com.evil.example/watch?v=abcdefghijk",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/",
    "https://youtu.be/not-valid",
    "not a url",
    "",
])
def test_resolve_rejects_invalid_urls_honestly(api: Any, monkeypatch: pytest.MonkeyPatch, url: str):
    called = []
    monkeypatch.setattr(api, "_youtube_extract", lambda *a, **k: called.append(1) or entry())
    body = run(request(api, "POST", "/youtube/resolve", json={"url": url})).json()
    assert body["ok"] is False
    assert body["error"] == "Paste a valid HTTPS YouTube watch URL"
    assert called == [], "invalid input never reaches the provider"


def test_resolve_missing_metadata_is_an_honest_error(api: Any, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api, "_youtube_extract", lambda *_a, **_k: {"id": "abcdefghijk", "title": ""})
    body = run(request(api, "POST", "/youtube/resolve", json={"url": "https://youtu.be/abcdefghijk"})).json()
    assert body["ok"] is False
    assert body["error"] == "YouTube did not return playable video metadata"


def test_resolve_provider_failure_is_sanitized(api: Any, monkeypatch: pytest.MonkeyPatch):
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("Video unavailable: private video https://internal.example secret")

    monkeypatch.setattr(api, "_youtube_extract", boom)
    response = run(request(api, "POST", "/youtube/resolve", json={"url": "https://youtu.be/abcdefghijk"}))
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "YouTube video details could not be loaded"
    assert "secret" not in response.text
    assert "internal.example" not in response.text
