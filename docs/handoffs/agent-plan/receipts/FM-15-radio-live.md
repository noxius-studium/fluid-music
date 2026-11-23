# FM-15 receipt — Radio discovery, pins and source-honest LIVE behavior

Task: FM-15 (t_28d93939) · Board: fluid-music · Card: `kanban/FM-15.md`
Requirements: F05, F09, F10, F18, F20 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 9ac408a9d2ecd0fb4c695d371f836917ac82f22a (remote read-back equal; tree clean).

## 1. Preserved behavior (verified, not rewritten)

- Radio Browser discovery: backend `/radio/search` uses the fixed HTTPS directory endpoint, bounded limit (clamp 50), `hidebroken`, off-event-loop, no redirect following; `_station_from_directory` drops non-UUID stations, unsafe/private/credential URLs and HLS. Renderer `RadioPage` re-validates every row through `normalizeQueueItem`/`safeRadioStreamUrl` (HTTPS-only, credential-free, SSRF literal-host blocklist incl. IPv4 private ranges and IPv6 loopback/ULA/link-local). Presets + custom HTTPS stream dialog retained. All already fixture-covered (fluid-music.test.mjs, test_plugin_api.py) and passing unmodified.
- LIVE semantics: `mediaCapabilities(radio)` = play+volume only (no previous/next/seek/shuffle/repeat/device); shared bottom bar shows "LIVE · station broadcast", mini pane shows "LIVE" — never a fake seek or station-content skip. Queue-level navigation still works through the one coordinator.
- History: recorded only on the confirmed `playing` event, exactly once; failed streams record nothing (history-ux suite, passing unmodified).

## 2. Gaps closed (scoped changes)

- **Radio Browser click registration** (`30-controller.js` startRadio): the backend `/radio/click/{stationuuid}` route existed but was never called. Now one bounded, fire-and-forget, failure-tolerant POST per play attempt for canonical-UUID directory stations only (presets/custom ids excluded). Never gates playback, never proxies the stream; disposal ends it. Backend keeps UUID validation, fixed endpoint, `follow_redirects=False`, and never leaks the untrusted 302 destination.
- **Honest failure boundaries** (startRadio): MediaError code 2 → network-boundary message; 3 → decode/codec message; 4 → unsupported format-or-origin (codec/CORS) message; unexpected live `ended` → reconnect message; 15s connect timeout and rejected `play()` keep the honest connect-failure message. No raw URLs/tokens in messages; other sources unaffected.

## 3. New fixtures (labelled headless doubles; NO public stream launched)

- `tests/radio-live.test.mjs` (NEW, 5): pin/unpin/persistence across restarts + `resetSavedRadio` clears radio pins only + local not pinnable; enqueue selects without an engine vs explicit play starts exactly one + unsafe URLs rejected with honest message; failure cleanup (network/codec/CORS/ended messages, timeout armed+fires, rejected play settles error, zero false history, confirmed playing clears timeout, stale-generation events fenced, exactly-once history per station); click registration (UUID-only, one per play attempt, pause none/resume one, presets excluded, disposal ends, directory failure never blocks playback); LIVE surface static proofs (capability table + bar/mini LIVE lines).
- `tests/test_plugin_api.py` (+2): `/radio/click` rejects non-UUID before any directory call; canonical UUID hits the fixed click endpoint with `follow_redirects=False` and no stream-destination leak; directory HTTP failure returns the sanitized error.

## 4. Changed files

- `desktop/src/30-controller.js` — radio adapter only (click registration + boundary-specific failure reporting).
- `desktop/plugin.js` — regenerated (`build_desktop.py`, `--check` clean).
- `tests/radio-live.test.mjs` — NEW.
- `tests/test_plugin_api.py` — 2 radio-click tests appended.
- This receipt.

## 5. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **135 tests, 134 pass, 1 fail** — only the pre-existing FM-18 stale Spotify-discovery-copy assertion. All 5 new radio fixtures pass; every prior suite passes unmodified.
- `.venv/bin/python -m pytest -q` → **121 passed** (119 baseline + 2 new).
- `build_desktop.py` + `--check` exit 0; bundle ESM syntax OK.
- No live Radio Browser requests, no public streams, no browser/Electron downloads, no Docker, no paid calls.

## 6. Honest boundaries (fixture vs live)

- Real station audio, actual CORS/codec behavior in the packaged renderer, directory availability and live click counts are **UNVERIFIED** — gated to FM-25 owner review. Fixtures prove validation, selection/enqueue/pin, failure cleanup and registration rules only.

## 7. Commit / push

- Commit SHA + parent + verified remote SHA: recorded in the board CALLBACK FINISH for t_28d93939 (this receipt is part of that same commit). Author Zero2 <deadtrix21@users.noreply.github.com>; push target docs/cloud-kanban-handoff only.
- Remaining dirty work after commit: none. Carried: FM-18 Settings/discovery copy (last stale node assertion), FM-19 keyboard/disposal audit, FM-22 recovery center (radio retry UX lives there), FM-23 adapter, FM-24 artifact + stale docs, FM-25 owner review.
- Next card: FM-16 (t_3126fef7) — approved local-library scanning, IDs and seekable playback. Continuing serially.
