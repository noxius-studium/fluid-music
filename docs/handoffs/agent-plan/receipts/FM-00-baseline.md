# FM-00 receipt — cloud workspace verification and baseline parity

Task: FM-00 (t_323feaf1) · Board: fluid-music · Card: `kanban/FM-00.md`
Requirements: F01, F25, F26, F27, F28, F30 · Written: 2026-11-19 (UTC)
Scope honored: read-only inventory + this receipt only. No source edits, no installs, no service/app/runtime start, no provider/account operations.

## 1. Actual cloud binding (verified, not assumed)

| Fact | Verified value | Evidence |
|---|---|---|
| Workspace | `/home/node/fluid-music` | `hermes kanban claim t_323feaf1` printed this workspace |
| Repository | `noxius-studium/fluid-music` | `git remote` / import receipt |
| Branch | `docs/cloud-kanban-handoff` (authorized non-main push target) | `git branch --show-current` |
| Start SHA | `16cb4b82f2be6fea37d07658b06fdcdb80cf3c6e` | `git rev-parse HEAD`; working tree clean (`git status --porcelain` empty) |
| Remote parity at start | remote `refs/heads/docs/cloud-kanban-handoff` = `16cb4b82f2be6fea37d07658b06fdcdb80cf3c6e` | `git ls-remote origin refs/heads/docs/cloud-kanban-handoff` |
| Baseline ancestry | `d6e2bf2df08ae455ac5b24a581c3f2212060afb0` IS an ancestor of HEAD | `git merge-base --is-ancestor` exit 0 |
| Profile | `default` (active Hermes profile) | runtime environment + board assignee |
| Provider | `nous` | `/home/node/.hermes/config.yaml` `model.provider: nous` |
| Main model | `qwen/qwen4-max:free` | config `model.default` |
| Delegated model | `qwen/qwen4-max:free`, provider `nous` (pinned) | config `delegation.model` / `delegation.provider` |
| Dispatch | HELD: `kanban.dispatch_in_gateway: false`; serial CLI-driven execution | config read-back |
| Git identity | `Zero2 <deadtrix21@users.noreply.github.com>` | `git config user.name/user.email` |
| Board import | 26 cards BLOCKED at start, zero runs, key→ID mapping verified | `import-receipt.local.json` (`all_blocked_verified`, `zero_runs_verified` true) + `hermes kanban list` |
| RAM budget | 8192 MB total, ~6116 MB available at start, 4 CPUs, no swap | `free -m`, `nproc` |

Resource mode for the whole chain: small serial checks only; no Docker/Compose/K8s, no browser/Electron/toolchain farms, no large downloads, no live account operations, no paid calls. SQLite checks use isolated temporary databases. Real sound, YouTube playback/volume, packaged Electron rendering, Windows media access and live Spotify/YouTube behavior remain explicitly UNVERIFIED on this headless cloud host.

## 2. Baseline parity — full source present, not Markdown-only

`git diff --stat d6e2bf2..HEAD` = 42 files changed, 8665 insertions(+), 0 deletions; every changed path is under `docs/handoffs/agent-plan/`. Therefore all backend/renderer/build files are byte-identical to the verified feature baseline `d6e2bf2`.

Present and inventoried:
- Backend: `dashboard/plugin_api.py` (1063 lines), `dashboard/local_library.py` (552 lines), `dashboard/manifest.json` (api: plugin_api.py, tab hidden), `dashboard/__init__.py`.
- Renderer: nine `desktop/src` fragments (`00-runtime` 7, `10-model` 269, `20-styles` 71, `30-controller` 1444, `40-ui` 700, `41-library` 788, `42-playlists` 613, `43-visualizer` 127, `44-workspace` 204 lines) and generated `desktop/plugin.js` (4223 lines).
- Build/packaging: `scripts/build_desktop.py` (byte-for-byte fragment join; `--check` staleness flag), `scripts/package.py`.
- Manifests: `plugin.yaml` (kind backend, v0.4.1, settings schema poll_interval_open/closed, radio_search_limit), `pyproject.toml` (hatchling; deps anyio/fastapi/httpx/yt-dlp; optional test pytest/ruff), `package.json` (private verification package; `test` = `node --test tests/*.test.mjs`; `test:ui` = playwright/axe/esbuild UI harness), `uv.lock`, `requirements-dev.txt`.
- Tests: `tests/test_plugin_api.py` (mocked-provider router/release-contract tests), `tests/test_desktop_build.py`, `tests/fluid-music.test.mjs` (65 tests over shipped bundle regions), `tests/ui/{entry.js,sdk-fixture.js,verify.mjs}` (Playwright chromium + axe — heavyweight, NOT run on cloud per policy).
- Historical docs preserved as source history: `README.md`, `DESIGN.md`, `PRODUCT.md`, `docs/architecture.md`, `docs/limitations.md`, release notes.

## 3. Toolchain discovered (no installs performed)

- Python 3.11.2 (system), node v24.22.3, `uv` and `npm` on PATH; `pytest`/`pnpm` NOT on PATH.
- System Python lacks `fastapi`, `httpx`, `anyio`, `yt_dlp`, `pytest` (import probes). `sqlite3` stdlib OK.
- Consequence: `tests/test_plugin_api.py` cannot run until a project venv exists. FM-01 should create an isolated venv via `uv` from the existing lock (small pure-Python wheels; within budget) and run the small pytest suite. No venv was created in FM-00 (write scope = receipt only).
- `python3 scripts/build_desktop.py --check` → exit 0: `desktop/plugin.js` is current with the nine fragments.
- `node --test tests/*.test.mjs` runs dependency-free (node builtins only) and WAS run — see §6.
- CLI note: every `hermes kanban` invocation prints a benign "install out of sync (pnpm…)" banner about the Hermes desktop artifact; it does not affect board operations. Per policy we do NOT rebuild/restart the Hermes installation.

## 4. Backend route inventory (actual source, `dashboard/plugin_api.py`)

Router: `APIRouter(dependencies=[Depends(_profile_scope)])`; `_profile_scope` binds optional `profile` query to Hermes profile home/secret scope. Response envelope `{ok:true,data}` / `{ok:false,error[,status_code]}`.

| Method+path | Line | Behavior / owner |
|---|---|---|
| GET /config | 480 | validated plugin settings + `_capabilities()` (spotify_connect auth=`hermes_auth_spotify`, radio_browser https-only-no-hls) |
| GET /spotify/auth/status | 487 | whitelisted Hermes auth-store metadata + setup (client_id_required, redirect_uri, dashboard URL) + process-local flow state |
| POST /spotify/auth/start | 499 | one daemon-thread Hermes PKCE login; optional transient public client_id; single-flight via `_spotify_auth_lock` |
| GET /player | 533 | Spotify playback state + settings |
| GET /devices | 540 | /me/player/devices; supplements from playback only on success-empty or 410 |
| POST /play | 566 | context_uri/uri/uris(1–50)/position_ms/offset validation → PUT /me/player/play |
| POST /pause, /next, /previous | 592/600/608 | Connect transport with optional device_id |
| PUT /volume | 616 | volume_percent 0–100 strict |
| PUT /seek | 629 | position_ms 0–86_400_000 strict |
| PUT /transfer | 646 | device_ids=[id], play boolean |
| GET/POST /queue | 661/666 | Spotify queue read / add uri |
| PUT /shuffle, /repeat | 675/687 | boolean / off·context·track |
| GET /search | 699 | q≤200, types whitelist, limit 1–10, offset≤1000 |
| GET /playlists | 717 | /me/playlists limit≤50 |
| GET /playlists/{id}/tracks | 727 | /playlists/{id}/items, ID regex `^[A-Za-z0-9]{1,64}$` |
| GET /youtube/embed-host | 798 | starts/returns 127.0.0.1-only capability-token wrapper URL for an 11-char video ID |
| GET /youtube/search | 811 | yt-dlp `ytsearchN:` flat extraction → normalized items (real titles, ≤300 chars, https artwork, duration bounded) |
| POST /youtube/resolve | 827 | strict HTTPS watch/youtu.be URL → full yt-dlp metadata → one item |
| GET/POST/DELETE /history | 844/858/870 | LocalLibrary SQLite history list/record/clear |
| GET/POST /local/roots, DELETE /local/roots/{id} | 879/888/900 | approved-folder roots |
| POST /local/rescan | 913 | bounded symlink-safe scan |
| GET /local/tracks, GET /local/tracks/{id} | 926/949 | indexed tracks incl. missing-row handling |
| GET /radio/search | 1018 | fixed HTTPS Radio Browser endpoint, no redirects, public-HTTPS non-HLS station filter |
| POST /radio/click/{stationuuid} | 1048 | UUID-validated click registration; never proxies the 302 stream |

YouTube embed host internals (lines 207–244): `ThreadingHTTPServer` on `127.0.0.1:0`, random `secrets.token_urlsafe(24)` path token, exact Host-header check, path regex `/{token}/youtube/{11-char id}`, CSP `frame-src https://www.youtube-nocookie.com`, `strict-origin-when-cross-origin` referrer, postMessage relay parent↔iframe. Capability URL is ephemeral — never durable history. Cross-host boundary: this loopback URL is NOT reachable from the owner's Desktop when the backend runs on this cloud host; live YouTube acceptance stays owner-side (policy §Source/state/security).

`dashboard/local_library.py`: profile-scoped SQLite (`default_database_path()` under HERMES_HOME/plugin-data/fluid-music), schema versioning in `_ensure_schema`, stable track IDs from canonical path, size+mtime fingerprint, history payload validation, roots/tracks/history tables. Cloud tests must use isolated temp DBs.

### Critical compatibility finding (feeds FM-01 / FM-09 / FM-23)

`plugin_api.py:37–110` `_load_spotify_integration()` runs AT MODULE IMPORT and imports Spotify from Hermes core (`hermes_cli.auth*`, `plugins.spotify.client`) or a sibling `spotify-*` plugin discovered on disk. If neither exists it raises ImportError, which aborts the ENTIRE backend module — taking YouTube, radio, local and history routes down with it. This directly conflicts with the current owner policy: Spotify must be FluidMusic-owned (`dashboard/providers/spotify.py` + protected token store), and optional-provider failure must never break other sources. FM-01 must make the boundary lazy/failure-isolated; FM-09 replaces the delegated implementation with the plugin-owned OAuth/PKCE client while retaining these route paths/shapes. The module docstring (lines 1–10) still states the superseded "reuse Hermes' bundled SpotifyClient" design — historical, to be reconciled in FM-09/FM-24.

## 5. Renderer inventory and action audit (actual fragments)

Registration (`44-workspace.js:190–205`): plugin id `fluid-music`, `defaultEnabled:true`; surfaces:
1. `media-route` in `ROUTES_AREA`, path `/media` → `MediaPage`.
2. `media-titlebar` in `TITLEBAR_AREAS.right`, order 18 → `TitlebarPlayer`.
3. `mini-player` in `panes`, placement right, 300×420 → `MiniPlayer`.
Style element injected on register, removed via `ctx.onDispose`. Controller created once per registration (`createController(ctx)` in `30-controller.js`), shared by all three surfaces.

`00-runtime.js` uses NAMED ESM imports from `@hermes/plugin-sdk`: `atom, Button, host, ROUTES_AREA, TITLEBAR_AREAS, useValue` — a missing named export would abort the whole plugin before fallback (policy requires namespace import + capability checks; FM-01/FM-23).

Controller public API (`30-controller.js` return object, ~line 1432): atoms `workspaceView, selectedPlaylist, undoState, titlebarOpen, queue, index, favorites, volume, status, message, logs, spotify, spotifyAuth, spotifyDevices, progress, playlists, localTracks, localRoots, history, shuffle, repeat, spotifyAutoplay, youtube`; actions `current, add, remove, move, clearQueue, resetSavedRadio, next, previous, playAt, toggle, seekTo, setVolume, setShuffle, setRepeat, setSpotifyAutoplay, toggleFavorite, refreshSpotify, refreshSpotifyAuth, refreshSpotifyDevices, startSpotifyAuth, transferSpotifyDevice, addYouTubeUrl, addYouTubeItem, searchYouTube, resolveYouTubeEmbedUrl, sessionTracks, openLocalFiles, refreshLocalLibrary, addLocalRoot, chooseLocalRoot, rescanLocalLibrary, removeLocalRoot, searchSpotify, searchSpotifyCatalog, loadSpotifyPlaylists, loadSpotifyPlaylist, playSpotifyPlaylistTrack, saveToPlaylist, createPlaylist, updatePlaylist, deletePlaylist, duplicatePlaylist, addToPlaylist, removeFromPlaylist, moveInPlaylist, playPlaylist, capabilities, clearLogs, refreshHistory, clearHistory, setPollingOpen, rest, polling, undoPlaylistEdit, toggleMute, enqueuePlaylist, saveQueueAsPlaylist, addManyToPlaylist, removePlaylistItems, deduplicatePlaylist, exportPlaylists, importPlaylists, playlistItems, selectPlaylist, setWorkspaceView`.

Action audit by surface:
- Main Media workspace (`MediaPage`): compact topbar wordmark→browse + primary nav Browse/Library/Queue/Settings (`PRIMARY_NAV`); Notice; NowPlayingBand (Orbit artwork, source chip, title/subtitle, Transport, SeekBar-or-LIVE line, VolumeControl, Spotify device line, Up Next preview rows→`playAt`, Open Queue).
  - Browse sub-tabs: Spotify (`SearchPage` — catalog search, play/enqueue), YouTube (`YouTubeControls` — search or paste HTTPS watch URL → `addYouTubeUrl`/`searchYouTube`, result rows play via `addYouTubeItem`), Radio (`RadioPage` — directory search, pins, direct play).
  - Library sub-tabs: Spotify (`SpotifyLibraryPage` — own playlists, playlist tracks, play/enqueue), Local (`LocalPage` — roots add/choose/rescan/remove, indexed tracks, unavailable rows, session file open), Collections (`PlaylistsPage` — create/edit/duplicate/delete, track picker, bulk edit/dedupe, import/export, legacy read-only mixes), History (`HistoryPage` — replay via `add`, clear-all, timestamps).
  - Queue (`QueuePage` + `QueueList`/`QueueEntry` in 40-ui/42-playlists): current occurrence, Up Next rows, play-at/remove/move, queue playlist contexts.
  - Settings sub-tabs: Providers (`SpotifyConnection` — connect/status/device transfer; `YouTubeControls`), Playback (VolumeControl, "Let Spotify continue after a track" autoplay switch), Diagnostics (`LogsPage` — sanitized log rows, clear logs).
- Titlebar (`TitlebarPlayer`): quiet status dot + source + title summary button (aria-expanded/haspopup), explicit play/pause Action, popover (`PlayerPopover`): orbit art, transport, seek-or-LIVE, volume, device line, Up Next preview, Notice, shortcuts "YouTube in Media"/"Open Queue"/"Open Media" (host.navigate). Escape/outside-pointer close, focus first control on open, trigger focus restored on cleanup.
- Mini-player (`MiniPlayer`, 43-visualizer.js despite filename): audio-only layout = art/title/subtitle + SeekBar-or-LIVE/status + Notice + `MiniControlBar` (previous/play-pause/next, volume range, Queue/Media links). YouTube layout = `EmbeddedYouTubeFrame` (backend capability URL via `resolveYouTubeEmbedUrl`, fallback `window.hermesDesktop?.getEmbedHostOrigin`, last-resort direct youtube-nocookie embed) + `YouTubeTransport` (postMessage command/listening relay, playerState→playing) over the SAME MiniControlBar. No analyser/visualizer is present.

## 6. Baseline checks ACTUALLY run (fixture/source evidence, not live acceptance)

1. `git merge-base --is-ancestor d6e2bf2… HEAD` → exit 0 (ANCESTRY_OK).
2. `git ls-remote origin refs/heads/docs/cloud-kanban-handoff` → equals local HEAD `16cb4b82…` at start.
3. `python3 scripts/build_desktop.py --check` → exit 0 (generated bundle current).
4. `node --test tests/*.test.mjs` → exit 1: **65 tests, 49 pass, 16 fail** (full log: scratch `fm00-node-test.log`). Failure classification against actual source:
   - 13 tests target the RETIRED owned-Browser YouTube architecture: they call `c.openYouTube`, `c.refreshYouTube`, `c.addCurrentYouTube` etc., which the current controller no longer exposes (the shipped architecture is the loopback embed host + `EmbeddedYouTubeFrame`). The old functions still exist as dead internal code (`30-controller.js:1155–1230`, `youtubeHandle`, `restartYouTubePolling`) but are unreachable from the public API. These tests are stale relative to the current working path; FM-03/FM-04 must replace them with equivalent embed-architecture coverage (generation fencing, exactly-once completion, one-engine handoff), not delete the underlying requirements.
   - 3 tests assert stale shipped-source strings: `--fm-night:` CSS token (current styles use `--fm-panel/--fm-soft/--fm-line`), `codicon: 'music'` (current titlebar uses semantic SVG `Icon`), and the copy "Play Spotify results now or add them to your temporary Up Next queue" (current SearchPage copy differs). FM-13/FM-18/FM-24 reconcile assertions with the current design contract.
   - The 49 passing tests cover queue/occurrence identity, stale-transition fencing, Spotify device/auth/progress semantics, radio validation, local collections/legacy preservation, persistence and disposal — this is the working regression base to preserve.
5. `pytest` NOT run: backend deps absent from system Python (§3). Honest gap; FM-01 runs it after isolated venv setup.
6. `tests/ui/verify.mjs` NOT run: requires Playwright chromium download + esbuild bundle — heavyweight, excluded by policy on cloud. Owner packaged-host review remains the live gate.

No test result above proves real audio, YouTube embed consent/playback, Spotify live behavior, or packaged Desktop rendering.

## 7. Stale documents marked HISTORICAL (superseded by EXECUTION_POLICY / DESIGN_CONTRACT)

Preserved unchanged as source history; NOT redesign requirements:
- `README.md:8,14,31,163` — "owned YouTube watch page / FluidMusic-owned Browser handle / host script consent" architecture. Superseded: current working path is the capability-protected loopback embed host; owned first-party watch fallback is a NEW FM-08 capability-gated feature, not the old Browser scripting.
- `README.md:63` — "Hermes-managed Spotify PKCE" delegation. Superseded: FluidMusic-owned Spotify (FM-09–FM-11).
- `DESIGN.md:4,123–157` — deep-navy/coral/violet private palette and No-Green rule. Superseded: Hermes semantic `--ui-*` theme authority, tinted themes allowed.
- `DESIGN.md:14,170` — 58px now-playing display. Superseded: app-scale titles (page 19–25px).
- `DESIGN.md:198` — "The One-Player Rule… Never add a bottom player bar." Superseded: shared bottom transport for ALL sources (F09).
- `DESIGN.md:270` — YouTube transport "only through FluidMusic's owned Browser tab state". Superseded by embed bridge + FM-08 fallback.
- `dashboard/plugin_api.py:1–10` docstring — "Spotify calls deliberately reuse Hermes' bundled SpotifyClient". Superseded by plugin-owned Spotify contract.
- `docs/architecture.md`, `docs/limitations.md`, `PRODUCT.md` — historical where they describe the above; FM-24 reconciles wording.
Retained character (still authoritative): Night Radio hierarchy, Orbit circular artwork object, compact Blackstage-style navigation, source-honest LIVE semantics.

## 8. Findings queued for downstream cards (observed, not fixed in FM-00)

- FM-01: module-level Spotify import aborts whole backend (§4); named SDK ESM imports (§5); venv + pytest baseline.
- FM-03/FM-04: dead owned-Browser code (`openYouTube/runYouTube/addCurrentYouTube/youtubeHandle`, `restartYouTubePolling` polls a handle that can never be set); `YouTubeTransport` posts commands to `'*'` and validates incoming messages only by `event.source` (no origin/schema/generation checks); toggle double-sends after 250 ms; embed fallback chain ends at a direct nocookie URL with `origin=https://www.youtube.com` while the wrapper uses the loopback origin — readiness/origin consistency needs the FM-04 bridge work.
- FM-12/FM-14: mini volume range is 90px (`fluid-mini-volume .fluid-range{width:90px}`) vs contract 150–170px usable; mini-player pane declared 300×420.
- FM-13: `.fluid-now-title` clamp(25px,3.4cqw,46px) and `.fluid-panel-pad{padding:22px}` exceed app-scale contract targets.
- FM-19: controller `onDispose` does not close/dispose any YouTube handle or iframe relay; stale owned-Browser disposal gap.
- FM-09–FM-11: replace delegated Spotify with owned modules, keep route shapes in §4.
- FM-23/FM-24: capability adapter, stale doc reconciliation, artifact build.

## 9. Protected work (untouched)

`.env`/auth/credential stores, runtime `plugin-data`/SQLite/user media, Hermes installation/profile config/gateway (no restart, no dispatch enable, no artifact rebuild), `main`/tags/releases, historical Windows checkout, all repo source files (FM-00 changed only this receipt). No unrelated work existed in the tree (clean at start).

## 10. Acceptance status and next card

- [x] Actual clone contains the d6e2bf2 baseline and full backend/renderer source (parity proof §2; ancestry §1).
- [x] START receipt states exact source SHA, profile/provider/model, RAM budget and protected work; no service/app/runtime install started (board comment 2026-11-19 11:13, read back via `kanban show`).
- Unverified by design on cloud: live audio/YouTube/Spotify/Desktop acceptance (§6).
- Next existing card: FM-01 (t_59c39a5e) — host SDK/backend compatibility reconciliation. Continue serially after FINISH callback.
