# FM-18 receipt — Dedicated Settings, truthful status and sanitized diagnostics

Task: FM-18 (t_41015ffb) · Board: fluid-music · Card: `kanban/FM-18.md`
Requirements: F02, F05, F06, F23, F29, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: f49f2b4b42ece25fba49cc69f534798252560ad4 (remote read-back equal; tree clean).

## 1. Stale assertion retired with real copy (not weakened)

- The last carried stale node assertion ("Spotify discovery copy never promises forbidden FluidMusic collection saves") required the approved truthful discovery wording that Browse's Spotify SearchPage had lost during the compact redesign. Restored it as a real `fluid-section-copy` line above the search bar: "Play Spotify results now or add them to your temporary Up Next queue. FluidMusic collections are local-only; your Spotify playlists stay on Spotify." The test passes UNMODIFIED; forbidden save-promising copy remains absent. **Node baseline is now 143/143 — zero stale failures.**

## 2. Audit result — Settings/diagnostics contract already implemented

- Dedicated Settings destination (Providers / Playback / Diagnostics tabs) with the OWNED SpotifyConnection card (Disconnected/Connecting/Authenticated states, client-id setup, device list with active/restricted facts, transfer, local-playback capability assessment), playback volume + Spotify-continuation preference, and LogsPage. No redundant sidebar discovery; titlebar/route/plugin settings remain the discovery paths.
- Status honesty: selected source vs provider readiness vs actual playing are separate atoms; auth/device failures classify into the official-status remedy matrix (auth-required/rate-limited/scope/forbidden/no-device/…) without touching playback status or other sources.
- Diagnostics sanitization: structured fields only (`diagnosticBody` extracts context/track + masked device suffix; routes logged without query strings; host-internal error shapes replaced by safe fallbacks; quiet polling routes not spammed; 250-entry bound; clearLogs touches nothing else).

## 3. New fixtures

`tests/settings-diagnostics.test.mjs` (NEW, 4, labelled headless doubles):
1. Settings real effects + persistence + restart restore: volume clamp/unmute-restore, spotifyAutoplay on/off, workspaceView legacy aliases, exact restore on a fresh registration.
2. Diagnostics: transfer logged with masked device suffix (full id absent), embed-host capability token never logged, query strings stripped, raw provider payload/host-internal error shapes replaced, 250-entry bound, clearLogs leaves queue/collections/storage byte-identical.
3. Spotify 401 auth/device failure: truthful failed state + auth-required/reconnect classification, playback status untouched, radio AND local still play, failed provider status stays visible.
4. Static: Settings three-tab structure, owned connection card (no sibling-plugin import), truthful connecting/no-device/local-capability copy, sanitized diagnostics copy.

## 4. Changed files

- `desktop/src/41-library.js` — SearchPage discovery copy line only.
- `desktop/plugin.js` — regenerated (`--check` clean, ESM OK).
- `tests/settings-diagnostics.test.mjs` — NEW.
- This receipt.

## 5. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **143 tests, 143 pass, 0 fail, 0 cancelled** (stale FM-18 assertion retired; all prior suites unmodified).
- `.venv/bin/python -m pytest -q` → **130 passed** (no backend change).
- `build_desktop.py` + `--check` exit 0; bundle ESM syntax OK.
- No live provider/account/backend calls; no downloads/Docker/paid calls.

## 6. Honest boundaries

- Headless doubles only. Live Settings rendering, real OAuth browser flow, device transfer against a real account and packaged-Desktop diagnostics display remain **UNVERIFIED**, gated to FM-25.

## 7. Commit / push

- Commit SHA + parent + verified remote SHA: recorded in the board CALLBACK FINISH for t_41015ffb (this receipt is part of that same commit). Author Zero2 <deadtrix21@users.noreply.github.com>; push target docs/cloud-kanban-handoff only.
- Remaining dirty work after commit: none. Carried: FM-19 keyboard/disposal audit, FM-22 recovery, FM-23 adapter, FM-24 artifact + stale docs (incl. tests/ui), FM-25 owner review.
- Next card: FM-19 (t_7e3c4120) — keyboard, icon, error and disposal gaps across all surfaces. Continuing serially.
