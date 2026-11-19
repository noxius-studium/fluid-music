# FM-03 receipt — one-engine handoff and Up Next lifecycle

Task: FM-03 (t_cff9ccb8) · Board: fluid-music · Card: `kanban/FM-03.md`
Requirements: F10, F17, F18, F19 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 43978dde1de6e47c0e00bf3b71e11024a55901b7 (remote read-back equal; tree clean).

## 1. Investigation (verified before edits)

Coordinator audit of the shipped controller:
- Every start/pause/skip/continuation already routes through `runTransition` (serialized chain + monotonic token). `playAt`/`toggle`/`next`/`previous`/`remove(current)` stop the prior source via `stopActive` before `startSelected`; `startRadio`/`startLocal` additionally `stopInternalAudio()` (generation bump + element removal) and fence every listener with `isCurrent()` (disposed + generation + element identity + current id).
- Exactly-once completion: local `ended` → `next()` is fenced by `isCurrent()` AND the transition token check inside the queued work — duplicate synchronous `ended` deliveries collapse to ONE successor start (verified by a new fixture that passes against the existing design; no redundant flag added). Spotify completion uses the armed queue guard (`advancing`/`seenExpected`/token). Radio `ended` is an honest failure, not an advance. History is recorded once per start (`historyRecorded`) and deduped within 5 s.
- Queue identity: positional selection + `normalizeQueueSelection`, occurrence-safe `remove`/`move`, duplicate occurrences preserved (existing passing tests), restart-safe persistence via `serializePlaylistItem` (no object URLs/handles/paths for cloud items).
- YouTube in the embed architecture: selection is coordinator-owned (`startSelected` youtube branch), playback is surface-owned (loopback iframe + postMessage relay in the mini-player). The controller exposes no YouTube media commands; `seekTo`/`setVolume`/`toggle` are provider no-ops for YouTube by design (embed controls own them; FM-04/FM-12 finish the bridge/unification).

Defects/gaps found and fixed:
1. DEAD retired owned-Browser architecture still shipped: `openYouTube`, `runYouTube` (injects scripts into a focused chat preview via `ctx.preview.executeJavaScriptIn` — prohibited by F13/policy), `addCurrentYouTube`, `playCurrentYouTube`, `toggleYouTube`, `youtubeHandle`, and `restartYouTubePolling` (a 2 s timer polling a handle that can never be set). Unreachable from the public API, but a live liability and the root of the 13 stale tests.
2. Leaving a YouTube item did not clear the `youtube` atom's reported `playing`/`ended` state — a stale embed snapshot could describe the next source after handoff.
3. The YouTube continuation guard was never armed on selection (the embed bridge in FM-04 needs it bound to the exact occurrence/token).

## 2. Changes (exact files)

- `desktop/src/30-controller.js` (net −97 lines):
  - Removed all dead owned-Browser functions/variables listed above, the dead 2 s polling timer (init call + dispose clear included). Zero `ctx.preview` references remain in the controller. Kept: `youtube` atom, `armYouTubeQueueGuard`/`requestYouTubeQueueAdvance` (FM-04 bridge consumes them), `addYouTubeItem`/`addYouTubeUrl`/`searchYouTube`/`resolveYouTubeEmbedUrl`/`refreshQueuedYouTubeMetadata`.
  - `stopActive`: YouTube branch clears reported `playing`/`ended` on handoff.
  - `startSelected` YouTube branch: `armYouTubeQueueGuard(item, token)` binds continuation to the selected occurrence (behavior-neutral until FM-04 wires the ended relay).
- `desktop/plugin.js`: regenerated (`--check` exit 0; full-bundle ESM syntax check OK).
- `tests/fluid-music.test.mjs`: replaced the 13 stale retired-owned-Browser tests IN PLACE with embed-architecture equivalents that preserve every underlying requirement:
  1. chat focus/surface changes cannot mutate the selected YouTube occurrence or issue commands (no Browser preview ever).
  2. embed resolution accepts only the backend loopback capability URL; rejects foreign/malformed/invalid-ID state.
  3. YouTube queue items require credential-free HTTPS watch URLs + safe metadata (kept); capability assertion reconciled to the honest embed model (controller transport false; surface owns controls).
  4. resolve results enqueue safe restart-safe metadata; no capability URL persisted; restart never auto-plays.
  5. radio→YouTube handoff stops the radio engine, embed owns playback (no fake playing), handing back resets YouTube reported state and restarts exactly one engine.
  6. invalid input/backend failures are honest and never enqueue foreign page data.
  7. no controller-side YouTube polling exists; compact surfaces create no observation timers; Spotify cadence switching intact.
  8. YouTube controller transport never mutates media, issues provider commands, or scripts a Browser.
  9. a different YouTube video is a distinct occurrence; enqueue never retargets selection; play-at selects the exact occurrence.
  10–11. radio/spotify → explicit YouTube play stops the active provider before the embed selection (order asserted; no internal engine runs alongside the embed).
  12. duplicate local `ended` deliveries advance and start the successor exactly once (protection fixture — existing token fencing already correct).
  13. a late YouTube metadata resolve cannot overwrite a newer selection or advance the queue; matching occurrence metadata still updates.

## 3. Checks and ACTUAL results

1. RED (after test replacement, before product edits): 65 tests in fluid-music.test.mjs → 60 pass / 5 fail: the 3 stale string assertions (unchanged, FM-13/18) + no-YouTube-polling fixture + handoff-state-reset fixture. The duplicate-ended fixture passed immediately — classified as existing-behavior protection, not a defect (scratch `fm03-red.log`).
2. GREEN (after product edits): full `node --test tests/*.test.mjs` → **78 tests, 75 pass, 3 fail** (scratch `fm03-green.log`). All 62 prior passes preserved + 13 replaced tests now pass. Remaining 3 failures are exactly the stale shipped-string assertions: `--fm-night` CSS token (FM-13), old Spotify discovery copy (FM-18), and the shipped-features test which now fails on the retired `fluid-music-youtube` owned-browser key assertion (previously failed on `codicon:'music'` in the same stale test — same test, same FM-13/18/24 reconciliation scope; the key legitimately disappeared with the dead architecture).
3. `.venv/bin/pytest tests/ -q` → **40 passed** (unchanged).
4. `python3 scripts/build_desktop.py --check` → exit 0; `node --input-type=module --check` on the bundle → OK.
5. Push verification: FINISH callback (commit SHA + `git ls-remote` read-back).

## 4. Fixture-vs-live limits

Headless controller-region fixtures with labelled doubles only. NOT proven: real audio, actual iframe/embed playback or its postMessage relay behavior (FM-04), packaged-Desktop rendering, live Spotify/YouTube. The YouTube "engine" in these fixtures is the controller's state contract; the iframe lifecycle is surface-owned and unmount-stops-playback by construction, which only the owner's packaged host can confirm.

## 5. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 62 prior node passes + 40 pytest baseline, Spotify owned implementation (FM-09), embed bridge origin/schema/generation hardening (FM-04), capability/model semantics (FM-12). No live provider/account operations, no paid calls.

## 6. Remaining acceptance / downstream

- FM-04 (next): wire the embed command/state bridge — origin/schema/generation checks, ended→`requestYouTubeQueueAdvance`, toggle double-send fix, readiness/origin consistency; the guard is now armed on selection.
- FM-12: unify bottom transport/volume across sources (capability model revisit).
- FM-13/FM-18/FM-24: reconcile the 3 remaining stale string-assertion tests with the current design contract.
- FM-25: owner review of real handoff/completion behavior on packaged Desktop.
