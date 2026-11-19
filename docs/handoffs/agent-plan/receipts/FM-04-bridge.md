# FM-04 receipt — integrated YouTube command/state bridge

Task: FM-04 (t_756a143a) · Board: fluid-music · Card: `kanban/FM-04.md`
Requirements: F08, F09, F10, F13, F14, F17 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 92cf1ceb1f8f866f22ba220b0f1ef739324c4a9a (remote read-back equal; tree clean).

## 1. Findings (verified before edits)

- `YouTubeTransport` posted every command/listening message with `postMessage(..., '*')` and validated incoming messages ONLY by `event.source` — no origin, schema, video-ID or generation checks.
- Toggle double-sent the same command after a blind 250 ms `setTimeout` (duplicate-command risk, no acknowledgement binding).
- The last-resort direct nocookie embed hardcoded `origin=https://www.youtube.com` — a foreign origin that does not describe the actual embedding page (readiness/origin inconsistency with the loopback wrapper).
- The backend wrapper relay forwarded parent→iframe unconditionally and iframe→parent with `'*'`, no schema/channel validation.
- Controller messages said "Use the embedded YouTube controls…" — a native-control substitute notice even though FluidMusic's own custom transport exists in the player pane.
- Existing protections verified intact and fixture-proven: 127.0.0.1-only bind, random capability token, exact Host-header check, exact path/video-ID regex, CSP `frame-src https://www.youtube-nocookie.com`, `strict-origin-when-cross-origin` referrer, digit-only query params.

## 2. Changes (exact files)

- `desktop/src/10-model.js` (pure adapter helpers, inside PURE region): `youTubeCommandMessage` (whitelisted funcs playVideo/pauseVideo/seekTo/setVolume/mute/unMute/stopVideo; channel/id-bound schema), `youTubeListeningMessage`, `embedFrameOrigin` (origin derived from the ACTUAL frame src; http/https only), `parseYouTubePlayerMessage` (JSON/string tolerance; onReady/infoDelivery only; playerState integer −1…5; wrong-video rejection against the expected ID; bounded position/duration).
- `desktop/src/43-visualizer.js`:
  - `YouTubeTransport`: commands gated on actual `onReady` readiness (ref-backed, per-item reset) and targeted at the frame's real origin; incoming messages validated by source AND origin AND schema AND expected video ID; state reports flow to the controller adapter; single-send toggle (blind re-send removed); listening handshake origin-targeted; volume synced once on ready; play button disabled until ready (honest, not fake-working); listener/interval cleaned up on unmount/item change with a live flag.
  - `youtubeEmbedUrl`: origin parameter now the actual `location.origin` when http(s), omitted for opaque origins — never a guessed foreign origin.
  - `MiniControlBar`: optional `disabled` prop (audio layout unchanged).
- `desktop/src/30-controller.js`: new `reportYouTubeState(state)` adapter (exported): binds reports to the exact selected YouTube occurrence + transition generation; foreign/stale/disposed reports ignored; updates youtube atom/progress/status; `ended` → `requestYouTubeQueueAdvance()` (guard armed in FM-03; exactly-once via token + advancing flag). Substitute notices rephrased to accurate pane guidance ("YouTube transport is in the FluidMusic player pane.") — no native-control excuse remains; main-bar YouTube transport unification stays FM-12.
- `dashboard/plugin_api.py`: wrapper relay hardened — parent origin derived from `document.referrer` (strict-origin referrer policy), incoming parent messages validated by origin (or opaque `'null'` when the host origin is unknowable) + `fluid-music` channel + command whitelist/listening only; iframe→parent forwarding restricted to YouTube player origins, JSON-schema-checked, and targeted at the derived parent origin (wildcard only as the documented opaque-origin fallback, still source-validated). Token/Host/path/CSP/referrer protections unchanged.
- `desktop/plugin.js`: regenerated (`--check` exit 0; full-bundle ESM syntax OK).
- Tests: `tests/youtube-bridge.test.mjs` (new, 6): command whitelist/schema; origin derivation; message parse contract (ready/state/ended/wrong-video/foreign-schema/out-of-range); shipped-source contract (no wildcard postMessage, no delayed re-send, origin+schema validation present, no hardcoded foreign origin); controller adapter occurrence/generation binding + exactly-once completion; stale reports after source change inert. `tests/test_youtube_embed_host.py` (new, 9): loopback-only bind + exact capability path + security headers; wrong token/path/video → 404 (5 cases); foreign Host → 404; relay origin-bound + schema-validated; route validates video ID before starting any server. One bounded ephemeral 127.0.0.1 server per fixture with explicit shutdown/server_close teardown. `tests/fluid-music.test.mjs`: one FM-03 fixture assertion updated to the intentionally rephrased pane-guidance copy.

## 3. Checks and ACTUAL results

1. RED: node bridge suite failed on the absent helper contract (`youTubeCommandMessage is not defined`); pytest relay-hardening test failed against the old wildcard relay while the 8 existing-protection tests passed (scratch `fm04-red-node.log`, `fm04-red-pytest.log`).
2. GREEN: bridge suite 6/6; full `node --test tests/*.test.mjs` → **84 tests, 81 pass, 3 fail** — all 75 prior passes preserved + 6 new; remaining 3 are exactly the stale shipped-string assertions (FM-13/18/24). One intermediate failure was this card's own message-copy change caught by an FM-03 fixture assertion; assertion updated, suite re-run clean (scratch `fm04-node-full2.log`).
3. `.venv/bin/pytest tests/ -q` → **49 passed** (40 prior + 9 new), owned servers torn down.
4. `build_desktop.py --check` exit 0; `node --input-type=module --check` bundle OK; ruff on plugin_api.py: same 6 pre-existing findings, zero new.

## 4. Acceptance honesty — issued messages ≠ playback proof

The fixtures prove command issuance contracts, message validation, readiness gating, occurrence/generation fencing and exactly-once completion at the logic/headless level. They do NOT prove: actual YouTube embed consent/autoplay, audible audio, real volume effect, packaged-Electron iframe rendering, or provider-side embedding decisions. Custom play/volume evidence here is "correctly issued + acknowledged state contract"; actual audible/video proof is reserved for the owner's Desktop review (FM-25). Provider restrictions remain in force (nocookie embed, no DRM/ad/download bypass); embed-denied content diagnosis/fallback is FM-07/FM-08.

Cross-host limitation stays explicit: the wrapper binds 127.0.0.1 only; when this backend runs on the cloud host its loopback capability URL is NOT reachable from the owner's Desktop. No 0.0.0.0 exposure, no public tunnel; live YouTube acceptance is owner-side.

## 5. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 75 prior node passes + 40 pytest baseline, capability model (FM-12), first-party watch fallback (FM-08), broader disposal (FM-19). No live YouTube/provider requests, no account operations, no paid calls.

## 6. Remaining acceptance / downstream

- FM-05 (next): YouTube search/URL resolution and real titles.
- FM-07/FM-08: failure diagnosis matrix + eligible first-party watch fallback.
- FM-12: unify bottom transport/volume (main-bar YouTube transport via the now-validated bridge).
- FM-19: disposal of any remaining relay resources on plugin teardown.
- FM-25: owner Desktop review of real embed playback, volume, readiness and restrictions.
