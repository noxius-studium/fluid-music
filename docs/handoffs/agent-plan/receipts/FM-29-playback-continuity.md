# FM-29 receipt — playback continuity / desktop-only assessment (owner follow-up)

Task: FM-29 (t_81236daa) · Board: fluid-music · Written: 2026-11-23 (UTC)
Owner basis: 2026-11-21 feedback item 5 ("music must never cut out for OAuth/URL fetches", decision delegated) + 2026-11-23 resume.
Profile: default · Provider: nous · Active route: tencent/hy4-flash:free. No delegation.
Repository: noxius-studium/fluid-music · Branch: docs/cloud-kanban-handoff
Baseline SHA: cf7ca33ab17f467683fe40be4827537f5d7705f1 (FM-28, verified ancestor).

## Assessment (decision, not deferred)

Full desktop-only operation is DECLINED: the renderer owns playback (one controller, one engine, generation-bound commands, storage state), but the OAuth PKCE callback listener, protected token store, yt-dlp work, profile SQLite and Radio Browser lookup need the Hermes plugin API. Moving an inbound listener and persistence into untrusted UI code would be worse security/design, not an improvement. The owner's actual pain is fixed directly: auth/URL/settings round-trips issue no media command and never change status/queue/index/engine, and the audio fallback is message-only.

## What changed

- `desktop/src/30-controller.js`: `downloadYouTubeAudioFallback` no longer calls `status.set('loading'|'paused'|'error')` — a background download is not a transport transition.
- `docs/architecture.md`: lean "Desktop-only operation and playback continuity (FM-29 assessment)" section with the honest boundary (host may duck audio on OAuth focus/gateway reload — owner review).
- `desktop/plugin.js` regenerated.
- Tests: `tests/playback-continuity.test.mjs` (2 static), `tests/titlebar-mini.test.mjs` (2 controller fixtures: auth/settings/URL ops and background fallback with state `playing`, zero media commands).
- Receipt: this file.

## Checks (actual)

- `build_desktop.py --check` clean; ESM syntax OK.
- `node --test tests/*.test.mjs` → 202 pass / 0 fail / 0 cancelled.
- `.venv/bin/python -m pytest -q` → 155 passed.
- No live OAuth/provider calls; labelled doubles only.

## Honest boundaries

Fixtures prove no media command and unchanged shared state during those fetches. They cannot prove the host browser/Desktop does not duck audio when an OAuth window opens, or that a gateway/plugin reload never remounts the surface — those remain explicit owner review.

Next: rebuild the artifact from the final commit and re-present FM-25 for owner acceptance (no self-approval).
