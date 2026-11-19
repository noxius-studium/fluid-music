# FM-02 receipt — registration-level playback and focus-switch continuity

Task: FM-02 (t_dfe7db12) · Board: fluid-music · Card: `kanban/FM-02.md`
Requirements: F07, F08, F17, F18, F19 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: a126af350917337c33768246e654d5ff756900a3 (remote read-back equal; tree clean).

## 1. Investigation (read-only before edits)

Verified against actual source:
- `44-workspace.js register(ctx)` creates ONE controller (`createController(ctx)`) after the FM-01 SDK gate and shares it by closure with all three surfaces (media-route, media-titlebar, mini-player). No per-surface or per-session controller creation exists.
- Controller state lives in atoms/closure + `ctx.storage`; surface mount/unmount only cycles polling cadence (`MediaPage` effect `setPollingOpen(true/false)`) and view-local state (tabs, search, popover). No focus/visibility/session listener in the controller region issues media commands; the controller region contains no `.focus(` call. Titlebar popover focus happens only on explicit open, with trigger-focus restore on cleanup.
- All surface `useEffect`s are observation-only (refresh/load) with unmount generation guards (`request.current++`, `mounted.current=false`, abort). Modal focus is inside explicitly opened dialogs.
- Queue advance paths (`requestHermesQueueAdvance`, `requestYouTubeQueueAdvance`, `updateSpotifyProgress`) are generation-bound and require an armed guard from an explicit user play plus the user's autoplay preference; observation alone cannot advance.

Defects found (same stale-lifecycle class, both reproduced RED before fixing):
1. `restartSpotifyPolling`/`restartYouTubePolling` had no `disposed` guard: a late `MediaPage` unmount/remount (`setPollingOpen`) AFTER plugin disposal recreated interval timers on the dead controller, resurrecting periodic provider polling. RED: timers 4 → 6 after dispose + two `setPollingOpen` calls.
2. `pollSpotifyAuth` rescheduled its 1500 ms timeout after `await refreshSpotifyAuth()` without a `disposed` check: disposal racing an in-flight auth poll left a live self-rescheduling loop (up to 80 attempts) on a disposed controller. RED: 1 uncleared 1500 ms timer after dispose.

## 2. Changes (exact files)

- `desktop/src/30-controller.js` (+7 lines): `restartSpotifyPolling` and `restartYouTubePolling` clear-and-null their timer, then return without recreating when `disposed`; `pollSpotifyAuth` returns (clearing any auth timer) when `disposed` after its await. No behavior change for live controllers; no transition/queue/transport semantics touched.
- `desktop/plugin.js`: regenerated via `scripts/build_desktop.py` (byte-for-byte fragment join; `--check` exit 0).
- `tests/focus-continuity.test.mjs` (new, 7 labelled headless fixtures over the shipped controller region; fake audio, stubbed REST/timers, in-memory storage):
  1. Controller identity, exact occurrence, index, queue, playback state and media destination stable across TWO simulated session switches + route remounts; zero media commands, zero false history posts, zero Browser/preview navigation.
  2. Polling observation fired across remount cycles preserves the selected occurrence/index and issues no transport commands or history; provider state reflected honestly.
  3. Registration contract: exactly one `createController` call (after the SDK gate), all three surfaces share it, controller region never manipulates focus.
  4. Late surface unmount/remount after disposal cannot revive polling timers or requests (RED→GREEN).
  5. In-flight auth poll cannot reschedule after disposal (RED→GREEN).
  6. Fresh registration restores the exact queue occurrence from safe storage; restore never auto-plays or records history.
  7. Positive control: explicit user play/pause still works after session switches with exactly one engine element.

Fixture bug found and fixed during RED: initial polling fixture used `move(0,1)` which selects the radio occurrence, not the intended Spotify one; corrected seeding (Spotify added first). Product code was not changed for that failure.

## 3. Checks and ACTUAL results

1. RED: `node --test tests/focus-continuity.test.mjs` → 5 pass / 2 fail, failures exactly the two disposal defects (logs: scratch `fm02-red.log`, `fm02-red2.log`).
2. GREEN focus suite: 7/7 pass (scratch `fm02-green-focus.log`).
3. Full node suite: `node --test tests/*.test.mjs` → **78 tests, 62 pass, 16 fail** (scratch `fm02-node-full.log`). All 55 prior passes preserved + 7 new. The 16 failures are byte-identical to the FM-00/FM-01 classified stale set (13 retired owned-Browser tests + 3 stale string assertions; FM-03/04/13 scope) — verified by sorted-name diff (`STALE_SET_IDENTICAL`).
4. `.venv/bin/pytest tests/ -q` → **40 passed** (unchanged).
5. `python3 scripts/build_desktop.py --check` → exit 0.
6. Push verification: FINISH callback (commit SHA + `git ls-remote` read-back).

## 4. Fixture-vs-live limits

All evidence is headless controller-region fixtures with labelled doubles. NOT proven here: real audio output, packaged Electron pane/session behavior, actual Hermes chat-session switching, YouTube embed playback, live Spotify. The session-switch fixture simulates the plugin-visible effects (polling cadence cycles, popover/view atoms) because the plugin has no session hooks by design — chat focus is not playback intent. Owner packaged-host acceptance remains FM-25.

## 5. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 55 prior node passes + 40 pytest baseline, dead owned-Browser internals (FM-03/04), transition/queue semantics. No live provider/account operation, no paid calls.

## 6. Remaining acceptance / downstream

- FM-03 (next): one-engine handoff + Up Next lifecycle; replace stale owned-Browser tests with embed-architecture coverage.
- FM-04: YouTube command/state bridge hardening (origin/schema/generation).
- FM-19/FM-22: broader disposal/stale-async durability (this card fixed the two polling/auth revival paths only).
- FM-25: owner review of real session-switch continuity on packaged Desktop.
