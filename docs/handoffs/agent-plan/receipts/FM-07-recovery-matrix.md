# FM-07 receipt — YouTube failure recovery matrix

Task: FM-07 (t_efc79a09) · Board: fluid-music · Card: `kanban/FM-07.md`
Requirements: F13, F14, F15, F32, F38 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 556a62c39bacde8e1a0fd77ee9d352480ce12999 (remote read-back equal; tree clean).

## 1. The sanitized reason/evidence → remedy matrix (implemented, deterministic)

Authority: PROVIDER_RESEARCH.md (official IFrame API reference). `classifyYouTubeFailure(signal)` in `10-model.js` returns `{reason, action, retryable, fallbackEligible, contentAvailable, message, remedy}`. `contentAvailable: null` means "no content verdict from this evidence" — never inferred from an iframe that merely did not start.

| Evidence (sanitized) | Reason | Action / remedy | Retryable | Fallback eligible | Content verdict |
|---|---|---|---|---|---|
| Player error 2 | invalid-video-id | skip — check URL/ID | no | no | none (bad input) |
| Player error 5 | html5-player-failure | retry once, then fallback/skip | yes (bounded, user-initiated) | yes | none |
| Player error 100 | video-not-found | skip — removed/not found | no | no | unavailable |
| Player error 101 / 150 | embed-denied-by-owner | first-party watch fallback (FM-08) or skip; retrying the same embed is pointless | no | yes | none — first-party watch MAY work; never guaranteed |
| Player error 153 | missing-referer-identification | fix origin/Referer configuration, reload | yes after fix | no | none (configuration, NOT owner denial) |
| onAutoplayBlocked | autoplay-blocked | interact — press play in the player | no (needs gesture) | no | none |
| Bridge: wrong video | wrong-video-state | retry reloads selected video | yes | no | none |
| Bridge: wrong origin | origin-mismatch | fix configuration / reload | yes | no | none |
| Bridge: not ready | player-not-ready | wait for readiness (commands already gated) | no | no | none |
| Bridge: stale generation | stale-generation | ignore (no user-facing error) | no | no | none |
| Provider: "Video unavailable"/removed | content-unavailable | skip | no | no | unavailable |
| Provider: "Private video" | private-video | skip | no | no | unavailable |
| Provider: sign-in/age confirmation | consent-required | genuine first-party sign-in surface (FM-08) or skip | no | yes | none |
| Provider: 429/quota | rate-limited | wait (bounded cooldown; FM-22 owns backoff) | yes | no | none |
| Provider: timeout/connection | network-error | check connection, bounded retry | yes | no | none |
| Anything else | undetermined | diagnose — retry once or copy diagnostics; NO unavailable/private/removed label, NO blind retry | no | no | none |

Backend `/youtube/search` and `/youtube/resolve` now return additive `error_code` from `_youtube_provider_error(exc)` using ONLY explicit yt-dlp signal text (private wins over generic unavailable); raw provider text never reaches the response. Success shapes unchanged.

## 2. Changes (exact files)

- `desktop/src/10-model.js`: `YOUTUBE_FAILURES` matrix + `classifyYouTubeFailure`; `parseYouTubePlayerMessage` extended with validated `onError` (integer code ≥0) and `onAutoplayBlocked` kinds; foreign shapes still rejected.
- `dashboard/plugin_api.py`: `_youtube_provider_error` explicit-signal classifier; search/resolve error envelopes carry `error_code` + sanitized message.
- `desktop/src/30-controller.js`: `reportYouTubeState` handles error/autoplay kinds generation-bound (stale reports ignored), sets youtube atom `{status, reason, error, action, retryable, fallbackEligible}` + remedy message; recoverable errors NEVER advance the queue or record history; `retryYouTube()` — explicit user action only, bumps `reloadToken` and re-selects the same occurrence (fresh embed load), no provider command storm; `startSelected` preserves `reloadToken`.
- `desktop/src/43-visualizer.js`: transport forwards error/autoplay reports without faking playback state; MiniPlayer remounts the frame on `reloadToken` change and shows the why-line plus explicit Retry (when retryable) / Skip actions.
- `desktop/plugin.js`: regenerated (`--check` exit 0; ESM syntax OK).
- Tests: `tests/youtube-recovery.test.mjs` (new, 8): documented-code matrix distinctness (incl. 101≡150 and 153≠denial), autoplay/bridge reasons, provider signals + unknown-never-unavailable, sanitized distinct copy per reason, onError/onAutoplayBlocked parsing, controller error reports (no advance/no history), bounded explicit retry with reload, surface Retry/Skip/no-auto-retry contract. `tests/test_youtube_diagnostics.py` (new, 10): explicit-signal classification (private/unavailable/consent/rate/network/undetermined), private-wins ordering, search parity, success shape unchanged, sanitization. All six headless harnesses updated for the new pure-helper factory dependency (harness contract only; the shipped bundle shares module scope). `tests/test_youtube_catalog.py`: two FM-05 generic-error expectations updated to the precise codes (intentional improvement).

## 3. Checks and ACTUAL results

1. RED: classifier absent (ReferenceError) + backend `error_code` absent (9 fail / 1 pass) — scratch logs.
2. GREEN: full `node --test tests/*.test.mjs` → **101 tests, 98 pass, 3 fail** (all 90 prior passes preserved + 8 new; remaining 3 exactly the stale string assertions, FM-13/18/24). Two intermediate failures were the headless harness factory contract missing the new helper — fixed in all six harnesses, not by weakening the product. `.venv/bin/pytest tests/ -q` → **91 passed** (81 prior + 10 new). `build_desktop.py --check` exit 0; ESM syntax OK; ruff: 6 pre-existing plugin_api findings, zero new.

## 4. Live evidence gate — the owner's actual failed videos (precise, NOT fabricated)

No live YouTube request, browser or embed was run on this cloud host; the owner's failing examples were NOT reproduced here. Classification above is deterministic contract coverage, not a claim about any specific video. To classify the owner's actual failures, collect on the Desktop (bounded, consented):
1. Sanitized video ID (11 chars), source/engine (loopback embed vs future first-party), selected occurrence + transition generation.
2. Exact player error code (2/5/100/101/150/153) or onAutoplayBlocked; readiness state (onReady received?), frame src origin, wrapper Referer/origin parameter, host/renderer versions, timestamp.
3. Login/consent state (signed in? age/consent interstitial?), whether ordinary first-party watch playback works for that same video/account, and retry history (attempts, outcomes).
4. One ordinary working video as control; then the authorized failing examples.
Until that evidence exists, affected videos stay `undetermined` with diagnose/retry-once/skip remedies — no all-videos promise, no catch-all unavailable label. FM-08 consumes `fallbackEligible` for the first-party watch surface; FM-22 owns bounded backoff/cooldown and the recovery center; FM-25 is the owner review gate.

## 5. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 90 prior node passes + 81 pytest baseline, FM-08 fallback engine, FM-22 backoff/recovery center, FM-12 transport unification. No live provider/account operations, no paid calls, no DRM/ad/download bypass.

## 6. Downstream

FM-08 (next): first-party watch fallback for eligible embed-denied/consent content. FM-12: transport unification. FM-13/18/24: stale string tests. FM-22: recovery center/backoff. FM-25: owner live-evidence review.
