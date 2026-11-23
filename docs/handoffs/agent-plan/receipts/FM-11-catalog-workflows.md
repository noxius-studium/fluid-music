# FM-11 receipt — Spotify catalogue/library/playlist workflows inside FluidMusic

Task: FM-11 (t_42c07b73) · Board: fluid-music · Card: `kanban/FM-11.md`
Requirements: F05, F15, F22, F29, F31 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: ac7ad39c8827fb22591ef1f0936889d9e2e4f625 (remote read-back equal; tree clean).

## 1. What was fixed/built

Official endpoint correction (real bug):
- Playlist item pages now call the OFFICIAL `GET /v1/playlists/{id}/tracks` — the route previously targeted `/playlists/{id}/items`, which does not exist in the Spotify Web API and would 404 against the live provider. Baseline assertion updated intentionally (it encoded the wrong path).

Honest unavailable/relinked entries (never silently dropped, never playable):
- `loadSpotifyPlaylist` now returns `tracks` (playable contract preserved), `unavailable` rows, and merged position-sorted `rows`. Removed/null tracks, `is_playable:false`, and `is_local` entries become visible rows at their EXACT occurrence position with `unavailable:true, playable:false` and a provider-specific reason (`spotifyEntryUnavailableReason`: removed / market / product subscription / explicit-content / local-file-not-synced / not-playable / generic). Explicit null `track`/`item` is respected (no wrapper-object fallback). Relinked tracks (`linked_from`) keep playing and are labelled "· relinked by Spotify".
- `playSpotifyPlaylistTrack` refuses unavailable rows with the honest reason — no provider play command. TrackRow already disables Play/Add for unavailable rows; detail copy now uses the provider reason instead of the local-file copy.
- Duplicate tracks keep exact occurrence offsets (`contextPosition = page offset + index`); occurrence-safe keys in queue-context, library detail and search results.

Scope errors distinct:
- `classifySpotifyFailure` gains `insufficient-scope` (403 + scope text → reconnect to grant scopes), distinct from generic `forbidden` (account/device restrictions).

Search pagination (cursor/state):
- `searchSpotifyCatalog` returns per-type `cursors` (from provider `next`) + the shared `offset` echo (Spotify applies one offset to every type). SearchPage accumulates pages via an explicit "Load more results" action with the existing request-token fencing (stale queries never overwrite newer results; unmount cancels).

Ownership boundaries preserved:
- Provider playlists stay on Spotify ("Your Spotify playlists stay on Spotify" copy; read-only browse — fixture-proven no writes). FluidMusic collections remain LOCAL (saveToPlaylist accepts indexed local tracks only; no remote playlist mutation anywhere). Listening-session snapshots (Up Next queue) remain separate from both.

## 2. Tests (bounded doubles; zero real credentials/network/account writes)

- `tests/test_spotify_catalog.py` (NEW, 5): official `/tracks` endpoint + pagination params + auth header; invalid playlist IDs/empty query/bogus type rejected BEFORE any provider request; search limit/offset clamp to provider bounds + type whitelist; 403 insufficient-scope propagation; catalogue workflows are strictly GET (no surprise remote writes).
- `tests/spotify-catalog.test.mjs` (NEW, 5): merged rows at exact positions [50..55] with 3 honest unavailable reasons + relink label + duplicate occurrence preservation + nextOffset/next; unavailable rows can never start playback (no /play call); pure reason matrix; insufficient-scope vs forbidden; cursors + shared offset payloads.
- Existing duplicate-occurrence baseline test (fluid-music.test.mjs) unchanged and passing — playable contract preserved.
- Harness contract: all 8 node harnesses inject `spotifyEntryUnavailableReason`.

## 3. Checks and ACTUAL results

1. `.venv/bin/pytest tests/ -q` → **119 passed, 0 failed** (114 prior + 5 new).
2. `node --test tests/*.test.mjs` → **116 tests, 113 pass, 3 fail** — the 3 are exactly the pre-existing stale string assertions (navigation destinations, workspace shipped-surface list, discovery copy) deferred to FM-13/18/24.
3. `build_desktop.py` + `--check` exit 0; bundle ESM syntax OK.
4. ruff: new test file **All checks passed**; plugin_api.py unchanged 5 pre-existing findings, zero new.

## 4. Honest boundaries

- ZERO real Spotify network/account operations; all catalogue evidence is MockTransport + temp homes + labelled doubles. Live search/library/playlist content, market restrictions on the owner account, and relink behavior remain explicitly UNVERIFIED owner-side (FM-25).
- No remote playlist writes exist or were added; any future save-to-Spotify feature would need explicit owner consent and is out of scope.
- Local-file (`is_local`) Spotify entries are honestly unplayable via Web API streaming — not a FluidMusic defect.

## 5. Protected work (untouched)

.env/auth/credential stores (legacy unmigrated), runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 113 node passes + 119 pytest requirements, FM-12 transport unification, FM-18 Settings states, FM-13 navigation.

## 6. Downstream

FM-12 (next): unify working bottom transport + usable volume everywhere. FM-13: navigation destinations (retires 1 stale assertion). FM-18: Settings states + discovery copy (retires 2 stale assertions). FM-23: adapter formalization. FM-25: owner live catalogue review.
