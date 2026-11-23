"""FM-21 resume/bookmark/retention/history-filter fixtures.

Labelled cloud fixtures: every database is an isolated temporary SQLite file
created by the test; NO user database, media or credential is read or written.
Route tests reuse the labelled host doubles from test_plugin_api. These prove
persistence, bounds, sanitization, filtering and retention semantics only —
real Desktop playback/seek and packaged-host behavior remain FM-25 acceptance.
"""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
import types
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

from test_plugin_api import api, app_for, run  # noqa: E402
from test_plugin_api import request as _raw_request  # noqa: E402


async def request(app: Any, method: str, path: str, **kwargs: Any) -> Any:
    """Labelled wrapper: the shared helper returns httpx.Response; fixtures assert JSON."""
    response = await _raw_request(app, method, path, **kwargs)
    return response.json()


@pytest.fixture(autouse=True)
def host_constants(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "hermes-home"
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)


def load_library_module():
    name = "fm21_local_library_under_test"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, ROOT / "dashboard" / "local_library.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def library(tmp_path: Path):
    module = load_library_module()
    return module.LocalLibrary(tmp_path / "fm21.sqlite3")


def youtube_item(video_id: str = "abcdefgh001", title: str = "Long Mix") -> dict[str, Any]:
    return {"source": "youtube", "id": f"youtube:{video_id}", "url": f"https://www.youtube.com/watch?v={video_id}", "title": title}


def radio_item(station: str = "jazz", title: str = "Jazz Live") -> dict[str, Any]:
    return {"source": "radio", "id": f"radio:{station}", "streamUrl": f"https://radio.example/{station}", "title": title}


def backdate(db_path: Path, entry_id: int, played_at: str) -> None:
    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE playback_history SET played_at = ? WHERE id = ?", (played_at, entry_id))
    connection.commit()
    connection.close()


def test_resume_roundtrip_is_bounded_and_rejects_unsafe_references(library: Any):
    assert library.get_resume("youtube:abcdefgh001") is None
    saved = library.save_resume("youtube:abcdefgh001", 754_000, 3_600_000)
    assert saved["position_ms"] == 754_000 and saved["duration_ms"] == 3_600_000 and saved["source"] == "youtube"
    updated = library.save_resume("youtube:abcdefgh001", 800_000, 3_600_000)
    assert updated["position_ms"] == 800_000, "upsert keeps one row per safe reference"
    assert library.get_resume("youtube:abcdefgh001")["position_ms"] == 800_000
    local = library.save_resume("local:track-1", 60_000, 1_800_000)
    assert local["source"] == "local"
    assert library.delete_resume("youtube:abcdefgh001") is True
    assert library.get_resume("youtube:abcdefgh001") is None
    assert library.delete_resume("youtube:abcdefgh001") is False
    for bad_key in ("local:C:/Music/x.mp3", "spotify:track:x", "youtube:has space", "youtube:" + "x" * 300, "", "youtube:a\x00b"):
        with pytest.raises(ValueError):
            library.save_resume(bad_key, 1, 2)
    for bad_position in (-1, 86_400_001, "abc", None):
        with pytest.raises(ValueError):
            library.save_resume("youtube:abcdefgh001", bad_position, 1000)


def test_bookmarks_crud_caps_and_sanitization(library: Any):
    key = "youtube:abcdefgh001"
    assert library.list_bookmarks(key) == []
    first = library.add_bookmark(key, 60_000, "Intro\x00riff  ")
    assert first["label"] == "Introriff", "control characters stripped, trimmed, bounded"
    second = library.add_bookmark(key, 30_000, "Earlier")
    listed = library.list_bookmarks(key)
    assert [row["position_ms"] for row in listed] == [30_000, 60_000], "ordered by timestamp"
    edited = library.update_bookmark(first["id"], position_ms=90_000, label="Edited")
    assert edited["position_ms"] == 90_000 and edited["label"] == "Edited"
    assert library.update_bookmark(999_999, label="Ghost") is None
    with pytest.raises(ValueError):
        library.update_bookmark(first["id"])
    with pytest.raises(ValueError):
        library.add_bookmark(key, -5)
    with pytest.raises(ValueError):
        library.add_bookmark("local:C:/Music/x.mp3", 5)
    assert library.delete_bookmark(second["id"]) is True
    assert library.delete_bookmark(second["id"]) is False
    assert library.delete_bookmark(first["id"]) is True
    for at in range(50):
        library.add_bookmark(key, at * 1000, f"B{at}")
    with pytest.raises(ValueError, match="50 bookmarks"):
        library.add_bookmark(key, 999_000, "One too many")


def test_history_filters_pagination_and_entry_removal(library: Any):
    library.record_history(youtube_item("abcdefgh001", "Deep Mix"))
    library.record_history(youtube_item("abcdefgh002", "Mix 100%_pure"))
    library.record_history(radio_item("jazz", "Jazz Live"))
    library.record_history(radio_item("rock", "Rock Live"))
    assert library.list_history(query="mix")["total"] == 2, "title search is case-insensitive"
    assert library.list_history(query="MIX")["total"] == 2
    literal = library.list_history(query="100%_pure")
    assert literal["total"] == 1 and literal["items"][0]["item"]["title"] == "Mix 100%_pure", "LIKE wildcards are escaped, not interpreted"
    assert library.list_history(source="radio")["total"] == 2
    assert library.list_history(source="radio", query="jazz")["total"] == 1, "filters compose"
    with pytest.raises(ValueError):
        library.list_history(source="bogus")
    with pytest.raises(ValueError):
        library.list_history(since="19/11/2026")
    with pytest.raises(ValueError):
        library.list_history(until="not-a-date")
    assert library.list_history(since="2026-11-19")["total"] == 4
    assert library.list_history(until="2026-11-18")["total"] == 0
    assert library.list_history(since="2026-11-19", until="2026-11-19")["total"] == 4, "until is inclusive of the whole day"
    page_one = library.list_history(limit=2, offset=0)
    page_two = library.list_history(limit=2, offset=2)
    assert page_one["total"] == 4 and page_two["total"] == 4
    ids_one = {entry["id"] for entry in page_one["items"]}
    ids_two = {entry["id"] for entry in page_two["items"]}
    assert ids_one.isdisjoint(ids_two), "stable pagination never duplicates or skips rows"
    target = page_one["items"][0]["id"]
    assert library.delete_history_entry(target) is True
    assert library.delete_history_entry(target) is False
    assert library.list_history()["total"] == 3


def test_retention_preference_prunes_safely_and_keeps_the_cap(library: Any, tmp_path: Path):
    assert library.get_history_retention() == 0
    old = library.record_history(youtube_item("abcdefgh001", "Old Mix"))
    fresh = library.record_history(youtube_item("abcdefgh002", "Fresh Mix"))
    backdate(library.database_path, old["id"], "2020-01-01T00:00:00+00:00")
    result = library.set_history_retention(30)
    assert result["days"] == 30 and result["removed"] == 1, "changing retention prunes immediately"
    remaining = library.list_history()["items"]
    assert [entry["id"] for entry in remaining] == [fresh["id"]]
    assert library.get_history_retention() == 30
    stale = library.record_history(youtube_item("abcdefgh003", "Stale Again"))
    backdate(library.database_path, stale["id"], "2020-01-01T00:00:00+00:00")
    library.record_history(youtube_item("abcdefgh004", "New Play"))
    assert library.list_history(query="Stale Again")["total"] == 0, "recording also applies retention"
    for bad in (7, -1, 366, "abc", None):
        with pytest.raises(ValueError):
            library.set_history_retention(bad)
    assert library.set_history_retention(0)["days"] == 0
    ancient = library.record_history(youtube_item("abcdefgh005", "Ancient"))
    backdate(library.database_path, ancient["id"], "2020-01-01T00:00:00+00:00")
    library.record_history(youtube_item("abcdefgh006", "Kept"))
    assert library.list_history(query="Ancient")["total"] == 1, "forever retention never prunes by age"


def test_route_history_filters_and_entry_removal(api: Any):
    app = app_for(api)
    assert run(request(app, "POST", "/history", json={"item": youtube_item("abcdefgh001", "Deep Mix")}))["ok"] is True
    assert run(request(app, "POST", "/history", json={"item": radio_item()}))["ok"] is True
    filtered = run(request(app, "GET", "/history?query=deep&source=youtube"))
    assert filtered["ok"] is True and filtered["data"]["total"] == 1
    bad_source = run(request(app, "GET", "/history?source=bogus"))
    assert bad_source["ok"] is False and "source" in bad_source["error"].lower()
    bad_date = run(request(app, "GET", "/history?since=19/11/2026"))
    assert bad_date["ok"] is False
    listing = run(request(app, "GET", "/history"))["data"]["items"]
    entry_id = listing[0]["id"]
    removed = run(request(app, "DELETE", f"/history/{entry_id}"))
    assert removed["ok"] is True and removed["data"]["removed"] is True
    again = run(request(app, "DELETE", f"/history/{entry_id}"))
    assert again["ok"] is True and again["data"]["removed"] is False


def test_route_retention_and_resume_bookmarks(api: Any):
    app = app_for(api)
    assert run(request(app, "GET", "/history/retention"))["data"]["days"] == 0
    updated = run(request(app, "PUT", "/history/retention", json={"days": 90}))
    assert updated["ok"] is True and updated["data"]["days"] == 90
    assert run(request(app, "GET", "/history/retention"))["data"]["days"] == 90
    bad = run(request(app, "PUT", "/history/retention", json={"days": 7}))
    assert bad["ok"] is False and "Retention" in bad["error"]

    key = "youtube:abcdefgh001"
    assert run(request(app, "GET", f"/resume?media_key={key}"))["data"]["resume"] is None
    saved = run(request(app, "PUT", "/resume", json={"media_key": key, "position_ms": 754_000, "duration_ms": 3_600_000}))
    assert saved["ok"] is True and saved["data"]["resume"]["position_ms"] == 754_000
    assert run(request(app, "GET", f"/resume?media_key={key}"))["data"]["resume"]["position_ms"] == 754_000
    unsafe = run(request(app, "PUT", "/resume", json={"media_key": "local:C:/Music/x.mp3", "position_ms": 1, "duration_ms": 2}))
    assert unsafe["ok"] is False and "safe" in unsafe["error"].lower()
    assert run(request(app, "DELETE", f"/resume?media_key={key}"))["data"]["removed"] is True

    assert run(request(app, "GET", f"/bookmarks?media_key={key}"))["data"]["items"] == []
    added = run(request(app, "POST", "/bookmarks", json={"media_key": key, "position_ms": 60_000, "label": "Intro"}))
    assert added["ok"] is True
    bookmark_id = added["data"]["bookmark"]["id"]
    edited = run(request(app, "PUT", f"/bookmarks/{bookmark_id}", json={"label": "Edited", "position_ms": 90_000}))
    assert edited["ok"] is True and edited["data"]["bookmark"]["label"] == "Edited"
    missing = run(request(app, "PUT", "/bookmarks/999999", json={"label": "Ghost"}))
    assert missing["ok"] is False and "no longer exists" in missing["error"]
    listed = run(request(app, "GET", f"/bookmarks?media_key={key}"))["data"]["items"]
    assert len(listed) == 1 and listed[0]["position_ms"] == 90_000
    assert run(request(app, "DELETE", f"/bookmarks/{bookmark_id}"))["data"]["removed"] is True
    assert run(request(app, "GET", f"/bookmarks?media_key={key}"))["data"]["items"] == []
