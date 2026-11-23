# FM-06 receipt — profile-scoped SQLite played history and clear/replay UX

Task: FM-06 (t_48e4baa0) · Board: fluid-music · Card: `kanban/FM-06.md`
Requirements: F05, F15, F16, F19, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: c23484d1619862f7afd0d59e2a5a5df8f9c956ff (remote read-back equal; tree clean).

## 1. Findings

Verified already-correct (fixture-proven, unchanged): SQLite ownership under HERMES_HOME/plugin-data/fluid-music with per-profile resolution at call time; additive schema discipline (CREATE IF NOT EXISTS + index, WAL, per-path init lock); payload identity/title requirements and size bounds; 5000-record retention; stable `played_at DESC, id DESC` ordering; bounded list (limit≤500, offset); clear scoped to history only (roots/tracks untouched); radio/local history gated on the actual `playing` event with once-per-start flags; Spotify history recorded only after the provider accepts `/play` (failures never recorded); controller 5 s duplicate-suppression window.

Defects found and fixed:
1. **YouTube recorded "played" at selection** (`startSelected` youtube branch called `recordHistory` before any playback confirmation — embed autoplay can be blocked, so merely-selected/queued videos were falsely marked played). Now recorded on the FIRST confirmed `playing` report of the transition via the FM-04 bridge (`reportYouTubeState`), once per transition (`youtubeHistoryRecorded` reset on each start).
2. **History payload accepted private references**: `objectUrl`/`filePath`/`playbackUrls`/path fields, token/secret/credential/capability-marked keys, non-https artwork, credential-bearing or foreign-host YouTube/radio URLs were persisted verbatim. Now stripped/rejected at the repository boundary.
3. **Indexed-local history replay was falsely unavailable**: durable references carry only `localTrackId` (no path), so `normalizeQueueItem` marked them unavailable and `add()` rejected replay even when the track exists in the current library. `add()` now relinks from the current `localRegistry` before the availability decision; unindexed/missing tracks remain honestly unavailable.
4. **Clear history had no confirmation** (immediate destructive action). Now an explicit scoped `Confirm` dialog stating exactly what is removed (this profile's recorded plays) and what is not (queues, collections, provider history), with busy/error handling via the shared Confirm component.
5. History display now shows bounded pagination honestly (`N of TOTAL recent plays` via a new `historyTotal` atom fed by the backend total).

## 2. Changes (exact files)

- `dashboard/local_library.py`: `_history_payload` sanitization (strip private/session/credential fields; https-only artwork; YouTube reference must be credential-free HTTPS on the YouTube host family; radio stream must be credential-free HTTPS; oversized payload still rejected). `urlparse` import added. No schema change (existing discipline reused).
- `desktop/src/30-controller.js`: `youtubeHistoryRecorded` per-transition flag; selection no longer records; `reportYouTubeState` records on first confirmed playing; `add()` relinks indexed local references from the current library before availability; `historyTotal` atom + refresh/clear maintenance + export.
- `desktop/src/44-workspace.js` (`HistoryPage`): scoped Clear confirmation via shared `Confirm`; honest `N of TOTAL` count; replay unchanged through the shared coordinator (`add(entry.item, true)`).
- `desktop/plugin.js`: regenerated (`--check` exit 0; ESM syntax OK).
- Tests: `tests/test_history_repository.py` (new, 14, isolated tmp SQLite only): reopen persistence + stable ordering; bounded clear with root/track isolation; two-profile isolation; 5000 retention bound; bounded/paginated queries; private-reference/credential/capability stripping; local safe-reference-only; unsafe YouTube/radio/identity-less rejection; oversized payload rejection. `tests/history-ux.test.mjs` (new, 5): YouTube selection≠played + first-confirmed-playing records once + duplicate/alternating reports never double-record + new transition after the suppression window records again; failed Spotify start never recorded; radio records on actual playing and a never-playing stream records nothing; indexed-local replay relinks and plays while unindexed replay is honestly unavailable; HistoryPage replay + scoped-confirm source contract. `tests/youtube-catalog.test.mjs`: FM-05 expectation updated to confirmation-gated history (selection records nothing; confirmed playing records once; status reflects confirmed playback).

## 3. Checks and ACTUAL results

1. RED: pytest 7 pass / 7 fail (sanitization/unsafe-reference/oversize expectations against the old payload path; fixture infrastructure corrected first: host-constants injection, and the oversize case moved to an unbounded extra field since subtitle truncation is correct behavior). Node 5 pass / 4 fail (confirmation gating ×2, replay relink, clear confirmation) — scratch `fm06-red-pytest2.log`, `fm06-red-node.log`.
2. GREEN: full `node --test tests/*.test.mjs` → **93 tests, 90 pass, 3 fail** (all 85 prior passes preserved + 5 new; remaining 3 exactly the stale string assertions, FM-13/18/24). One intermediate failure was the fixture's frozen clock hitting the EXISTING 5 s duplicate-suppression window on instant replay; the fixture now advances time for the deliberate replay (product behavior unchanged, documented). `.venv/bin/pytest tests/ -q` → **81 passed** (67 prior + 14 new), all databases isolated tmp files.
3. `build_desktop.py --check` exit 0; bundle ESM syntax OK; ruff: 7 findings total, ALL pre-existing (6 plugin_api + 1 local_library TRY004 verified on HEAD versions); zero new.

## 4. Fixture-vs-live limits

All history evidence is isolated temporary SQLite + headless controller doubles. NO user database was read or written. Real Desktop profile switching, actual played audio, and packaged rendering remain explicitly UNVERIFIED (FM-25). Spotify "played" semantics = provider-accepted `/play` (Connect command confirmation); audible proof is owner-side. The 5 s duplicate-suppression window is retained as existing storm protection; per-transition flags guarantee once-per-confirmation.

## 5. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 85 prior node passes + 67 pytest baseline, history filters/retention preference/per-entry removal (FM-21), recovery center (FM-22). No live provider/account operations, no paid calls.

## 6. Remaining acceptance / downstream

- FM-07 (next): YouTube failure diagnosis matrix with runtime-evidence classification.
- FM-21: history query/filters, per-entry removal, retention preference (builds on this card's bounded repository).
- FM-13/18/24: reconcile the 3 stale string-assertion tests.
- FM-25: owner review of real history/replay/clear on packaged Desktop.
