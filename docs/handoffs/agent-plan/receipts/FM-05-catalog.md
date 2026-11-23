# FM-05 receipt — YouTube search, URL resolution and real titles

Task: FM-05 (t_eb80011a) · Board: fluid-music · Card: `kanban/FM-05.md`
Requirements: F05, F13, F15 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 133724a0ef7cb8733eab4db5da2d44146ca3e42c (remote read-back equal; tree clean).

## 1. Findings

Verified already-correct (fixture-proven, unchanged): bounded yt-dlp flat search (`ytsearchN`, N≤20, q≤200), real titles required (entries without title/valid 11-char ID dropped — no invented records), titles ≤300 chars, https-only artwork with safe i.ytimg default, bounded duration, channel/uploader subtitle, sanitized provider failures (no internals/tracebacks), empty results returned as `ok:true items:[]` distinct from errors; renderer model `safeYouTubeWatchUrl` rejects credentials/foreign hosts/non-https; TrackRow already exposes explicit Play AND "Add … to queue" actions.

Defects found and fixed:
1. Backend `_youtube_watch_url` accepted credential-bearing URLs (`urlparse.hostname` strips userinfo, so `https://user:pass@www.youtube.com/watch?v=…` passed). Caught RED by the new invalid-URL fixture. Now rejected before any provider call, matching the renderer model.
2. `YouTubeControls` had no stale-query fencing: a slow earlier search could overwrite newer results, and responses could land after unmount. No explicit empty state after a completed zero-result search. Loading label did not distinguish URL resolution from search. Any-scheme URL input now routes to honest validation instead of being searched as text (http:// URLs get the valid-HTTPS error, not a text search).

## 2. Changes (exact files)

- `dashboard/plugin_api.py`: `_youtube_watch_url` rejects `parsed.username`/`parsed.password` with the standard honest error before extraction. No other handler change needed (bounded/sanitized behavior fixture-proven).
- `desktop/src/44-workspace.js` (`YouTubeControls`): request-generation token (`useRef`, bumped on unmount) — stale responses ignored for results/error/busy/query-clear; `mode` state distinguishes 'Resolving…' vs 'Searching…'; explicit `role="status"` empty state after a completed search; result-row keys occurrence-safe (`${item.id}-${at}`); Play via `addYouTubeItem(item, true)`, Add-to-queue via TrackRow's existing enqueue action (`controller.add(item)` — no playback, no history).
- `desktop/plugin.js`: regenerated (`--check` exit 0; ESM syntax OK).
- Tests: `tests/test_youtube_catalog.py` (new, 18): real bounded metadata (truncation/artwork/duration), identity-less entries dropped, honest empty, sanitized provider failure, query/limit bounds, supported watch/youtu.be/m.youtube URLs, 8 invalid-URL rejections with zero provider calls, missing-metadata error, sanitized resolve failure. `tests/youtube-catalog.test.mjs` (new, 4): enqueue = paused selection with no played event/commands; play carries the real title/subtitle to shared player atoms and exactly one sanitized history record (no capability URL); search normalization drops foreign entries; Browse surface stale-fence/loading/empty/enqueue source contract.

## 3. Checks and ACTUAL results

1. RED: node surface-contract test failed on the absent stale-fence/empty-state contract (3 controller protection tests passed); pytest invalid-URL fixture exposed the credential-bearing URL acceptance (17 pass / 1 fail) — scratch `fm05-red.log`.
2. GREEN: full `node --test tests/*.test.mjs` → **88 tests, 85 pass, 3 fail** (all 81 prior passes preserved + 4 new; remaining 3 exactly the stale string assertions, FM-13/18/24). `.venv/bin/pytest tests/ -q` → **67 passed** (49 prior + 18 new). `build_desktop.py --check` exit 0; bundle ESM syntax OK; ruff: same 6 pre-existing findings, zero new.

## 4. Fixture-vs-live limits

All provider evidence is labelled yt-dlp extraction fakes — NO live YouTube request was made. Real search result quality, titles, quota behavior, embed consent and playback remain explicitly UNVERIFIED (owner Desktop, FM-25). Deep quota/unavailable/geo root-cause classification is FM-07's recovery matrix; this card keeps errors honest and distinct from empty without inventing causes. No scraping/downloading beyond the existing bounded yt-dlp metadata extraction (policy-sanctioned search/resolve path).

## 5. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 81 prior node passes + 49 pytest baseline, FM-07 diagnosis scope, FM-08 fallback, FM-12 capability unification. No live provider/account operations, no paid calls.

## 6. Remaining acceptance / downstream

- FM-06 (next): profile-scoped SQLite played history and clear/replay UX.
- FM-07: failure classification matrix (quota/unavailable/geo/embed-denied) with runtime evidence.
- FM-13/18/24: reconcile the 3 stale string-assertion tests.
- FM-25: owner review of real search/titles/playback.
