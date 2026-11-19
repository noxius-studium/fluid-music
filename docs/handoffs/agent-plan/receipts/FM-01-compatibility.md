# FM-01 receipt — host SDK / backend compatibility reconciliation

Task: FM-01 (t_59c39a5e) · Board: fluid-music · Card: `kanban/FM-01.md` · Run 3
Requirements: F13, F14, F25, F29, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (config verified FM-00; no delegation used for this card).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 740d170d9406e94e8dcd6759b6de389d114a1a08 (remote read-back equal at start; tree clean).

Claim binding: stale run-2 lock (paused session) reclaimed by orchestrator 11:31; run 3 claimed by the gateway managed-worker bound to this execution session (HERMES_SESSION_ID matched worker pid). `kanban.dispatch_in_gateway` remains false; no Hermes restart, config change or dispatch enable.

## 1. Root cause (verified before fixing)

`dashboard/plugin_api.py` executed `_load_spotify_integration()` AT MODULE IMPORT and unpacked seven names from it. With neither core `hermes_cli` Spotify auth nor a sibling `spotify-*` plugin present, it raised `ImportError("The official Spotify plugin is not installed beside FluidMusic")` (line 63), aborting the ENTIRE backend module — YouTube, radio, local-library, history and /config routes died with it. RED evidence: `tests/test_optional_provider_boundary.py` fixture import failed with exactly that ImportError before the fix (scratch `fm01-red-pytest.log`).

Renderer: `desktop/src/00-runtime.js` used NAMED ESM imports (`atom, Button, host, ROUTES_AREA, TITLEBAR_AREAS, useValue`) from `@hermes/plugin-sdk`. A missing named export aborts the whole plugin at ESM link time, before any fallback can render (policy §Stability). RED evidence: `tests/sdk-boundary.test.mjs` failed on the absent namespace-import contract and absent SDK boundary region (scratch `fm01-red-node.log`).

## 2. Changes (exact files)

Backend — `dashboard/plugin_api.py`:
- Module docstring reconciled: describes the guarded optional boundary; the superseded "reuse Hermes' bundled SpotifyClient" design statement is gone (historical wording preserved in git history; README/PRODUCT reconciliation remains FM-24).
- Eager unpack replaced with lazy, failure-isolated resolution: the seven integration names start as `None`; `_resolve_spotify_integration()` loads once under a lock on the first Spotify-specific request, caches ready/unavailable state, never overwrites explicitly assigned values (test doubles), and raises `SpotifyIntegrationUnavailable` with the sanitized message "Spotify integration is unavailable in this Hermes installation" (no paths, tracebacks or OAuth details; load failure detail only at DEBUG log level).
- Resolution points: `_call` (returns `{ok:false,error}` envelope before any provider work), `_spotify_client`, `_spotify_auth_status_data`, `_spotify_setup_data`, `_run_spotify_auth` (records failed flow state safely). `/spotify/auth/status` and `/spotify/auth/start` have explicit unavailable branches; auth start never spawns a worker when the integration is absent.
- `_capabilities()` now reports truthfully: `spotify_connect.available` reflects actual resolvability; when unavailable it adds `unavailable_reason: "spotify-integration-unavailable"` (additive shape; `radio_browser` unchanged).
- `_client` annotation no longer references a possibly-absent class.
- The legacy host-delegated loader `_load_spotify_integration()` is retained UNCHANGED as an interim guarded compatibility path. It is now optional and lazy; the plugin-owned Spotify integration (FM-09) replaces it without changing route paths/shapes. No NEW sibling/core import was added; no Spotify implementation was copied from another plugin.

Renderer — canonical fragments only, `desktop/plugin.js` regenerated with `scripts/build_desktop.py`:
- `00-runtime.js`: `import * as HermesSDK from '@hermes/plugin-sdk'` + marked `SDK_BOUNDARY` region with pure `resolveSdk(namespace)` capability check. Required exports: `atom, useValue, host, ROUTES_AREA, TITLEBAR_AREAS`; `Button` is optional. Missing exports are detected at runtime, never at link time. React bindings (`react`, `react/jsx-runtime`) are stable platform APIs, not optional host exports, and remain named imports.
- `44-workspace.js`: registration gate — when the SDK is incompatible, register an honest `role="alert"` fallback surface (route if `ROUTES_AREA` exists, else the existing `panes` area contract) naming the missing exports; NO controller is created, no media command, queue mutation, polling or navigation is issued. Compatible hosts register the unchanged three surfaces.
- `40-ui.js`: `WorkspaceButton` falls back to a plain `button` when `Button` is absent (SDK-specific `variant`/`size` props only passed when the host component exists).

Contract/manifest:
- `dashboard/manifest.json`: description now includes YouTube (accuracy; name/api/tab.hidden unchanged).
- `tests/test_plugin_api.py`: reconciled the stale `test_router_exposes_frontend_contract` assertion `not any("youtube" in path)` — it contradicted the current working loopback-embed architecture that policy preserves. Expected route set now includes the actual YouTube (`/youtube/embed-host|search|resolve`) and history (`GET/POST/DELETE /history`) contract per the FM-00 inventory. No requirement was deleted; the assertion now matches the shipped working path.

New tests (labelled headless fixtures, not live evidence):
- `tests/test_optional_provider_boundary.py` (7 tests): host-present/Spotify-absent import + route mounting; explicit sanitized unavailable envelopes on `/spotify/auth/status`, `/player`, `/search`, `/spotify/auth/start` (flow stays idle, no worker); honest `/config` capabilities; isolated-temp-SQLite history roundtrip; YouTube search/resolve with labelled fixture metadata; radio search with fake directory; available-path check with a labelled fake integration.
- `tests/sdk-boundary.test.mjs` (6 tests): shipped bundle uses namespace import (no named SDK ESM bindings); `resolveSdk` contract over complete/optional-absent/core-absent/null namespaces.

## 3. Checks and ACTUAL results

Toolchain: isolated project venv created via `uv sync --extra test` from the existing `uv.lock` (small pure-Python wheels; ~5.6 GB RAM available before start; no Docker/browser/toolchain farms). `.venv/` is gitignored; `uv.lock` unchanged.

1. RED (before fix): boundary pytest failed with the exact module-import ImportError; sdk-boundary node tests failed on the absent contract. Logs: scratch `fm01-red-pytest.log`, `fm01-red-node.log`.
2. Baseline pytest (before fix, FM-00 deferred item): `pytest tests/test_plugin_api.py tests/test_desktop_build.py -q` → 32 passed, 1 failed — the single failure was the stale no-YouTube route assertion classified above. Log: scratch `fm01-pytest-baseline.log`.
3. GREEN pytest (after fix): `.venv/bin/pytest tests/ -q` → **40 passed, 0 failed** (33 existing incl. reconciled contract + 7 new boundary tests). Logs: scratch `fm01-pytest-green.log` + final rerun.
4. Node suite (after fix): `node --test tests/*.test.mjs` → **71 tests, 55 pass, 16 fail**. The 49 previously passing regression tests remain green; 6 new SDK-boundary tests pass. The 16 failures are EXACTLY the pre-existing stale set classified in FM-00 §6 (13 retired owned-Browser YouTube tests calling unexposed `c.openYouTube/c.refreshYouTube/...` + 3 stale shipped-string assertions: `--fm-night` token, `codicon:'music'`, old Spotify discovery copy). They belong to FM-03/FM-04/FM-13 and were not touched. Log: scratch `fm01-node-green.log`, failure names `fm01-fail-names.txt`.
5. `python3 scripts/build_desktop.py` then `--check` → exit 0 (generated bundle current with fragments).
6. `.venv/bin/ruff check dashboard/plugin_api.py tests/test_optional_provider_boundary.py tests/test_plugin_api.py` → 6 errors, ALL pre-existing (identical count on `git show HEAD:dashboard/plugin_api.py` via `--stdin-filename`: import sorting I001, BLE001 in legacy `configured_client_id`, unused noqa N802/BLE001 ×3, UP012 encode). New code is lint-clean; pre-existing lint deliberately not drive-by-fixed (repo-wide pass is FM-24/FM-25 scope).
7. Push verification: see FINISH callback (commit SHA + `git ls-remote` read-back).

## 4. Host SDK export evidence — precise limitation

No packaged Hermes Desktop SDK exists on this cloud host to verify exports against: there is no Electron app installation (`/opt/hermes/hermes_cli/web_dist` is the web UI bundle; the profile's bot-desktop is an XFCE/Xvnc headless Linux desktop, not the Hermes Desktop host). Therefore:
- Verified: the shipped bundle's SDK boundary contract against headless labelled fixtures, and compatibility with the repository's intended SDK fixture `tests/ui/sdk-fixture.js` (exports `atom, useValue, Button, SandboxedFrame, host, ROUTES_AREA, SIDEBAR_NAV_AREA, TITLEBAR_AREAS` — every required export present; `Button` optional-safe; `SandboxedFrame` not yet imported, reserved for FM-08 feature detection).
- UNVERIFIED: actual packaged-host named-export compatibility, real Desktop rendering, audio, YouTube playback/volume, live Spotify. These remain explicit owner-side acceptance (FM-25). No fake packaged-host acceptance is claimed.

## 5. Capability matrix (current, source-grounded)

| Capability | Door | Status |
|---|---|---|
| Registration surfaces | `ctx.register` areas `routes` (ROUTES_AREA), `titleBar.right` (TITLEBAR_AREAS.right), `panes` | required; guarded fallback when SDK constants absent |
| State | SDK `atom`/`useValue` | required; capability-checked |
| Navigation | SDK `host.navigate` | required; capability-checked |
| Buttons | SDK `Button` | optional; plain-button fallback |
| Storage | `ctx.storage.get/set` | used by controller; host-provided |
| REST | `ctx.rest` → this backend router | all routes mount without Spotify |
| File pick | `ctx.os.pickOpenPath` | local-library session open |
| Lifecycle | `ctx.onDispose` | style cleanup; controller disposal gaps remain FM-19 |
| Owned first-party video | SDK `SandboxedFrame` (fixture evidence only) | NOT imported yet; FM-08 must feature-detect before promising |
| Spotify integration | lazy guarded loader (interim) → plugin-owned (FM-09) | unavailable state explicit; never aborts other sources |

## 6. Protected work (untouched)

.env/auth/credential stores (including the existing Hermes auth store and any old Spotify credential store — no migration, no login, no token access), runtime plugin-data/SQLite/user media (tests used isolated tmp DBs), Hermes installation/profile config/gateway (no restart, no dispatch change), main/tags/releases, historical docs (FM-24), the 49 passing node regression tests, unrelated repo files. No live provider/account operation, no paid call, no network provider request (radio/YouTube tests used labelled fakes).

## 7. Remaining acceptance / downstream

- FM-02 (next): registration-level playback and focus-switch continuity.
- FM-03/FM-04: replace the 13 stale owned-Browser node tests with embed-architecture coverage; finish the command/state bridge (origin/schema/generation checks).
- FM-09: replace the interim guarded legacy loader with the FluidMusic-owned OAuth/PKCE client + protected token store, retaining route shapes; remove the sibling/core import path entirely.
- FM-13/FM-18: reconcile the 3 stale string-assertion node tests; surface honest capability states in Settings UI.
- FM-19: controller disposal of YouTube relay/handles.
- FM-23: formal public-SDK compatibility adapter + N/N+1 contract fixtures (this card's boundary is the seed).
- FM-24/FM-25: stale doc reconciliation, repo-wide lint decision, packaged-host owner review.
- Pre-existing ruff findings (6) and the Playwright UI harness (policy-excluded on cloud) remain open, classified, not silently fixed.
