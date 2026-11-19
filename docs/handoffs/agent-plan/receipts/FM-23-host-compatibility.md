# FM-23 receipt — Explicit Hermes-update compatibility, fragile coupling removed

Task: FM-23 (t_6ef84414) · Board: fluid-music · Card: `kanban/FM-23.md`
Requirements: F01, F25, F29, F30, F39, F40 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 85c1d17418f987fa3d62cda115a5035b7df5cd2a (remote read-back equal; tree clean).

## 1. Implemented scope

1. **Declared host contract (`HOST_CONTRACT`, contract v1)** inside the SDK boundary: required exports (`atom`, `useValue`, `host`, `ROUTES_AREA`, `TITLEBAR_AREAS`), every optional door with its exact fallback (Button, host.navigate, TITLEBAR_AREAS.right, OwnedMediaView, host.mediaSession, window.hermesDesktop.getEmbedHostOrigin, window.Spotify.Player), the minimum shape, and the N/N+1 policy with an explicit NO guarantee for arbitrary future breaking releases. `resolveSdk` now projects optional capabilities (`button`/`navigate`/`titlebarRight`) alongside `missing`/`compatible`.
2. **Optional-export traps removed (audit findings):**
   - Titlebar summary used raw `h(Button, …)` — Button is optional, so an absent export would crash the surface. Now `h(Button || 'button', …)` with conditional host props, same actions/labels/focus behavior.
   - `TITLEBAR_AREAS.right` was referenced unguarded at registration. Now `TITLEBAR_RIGHT` is capability-checked; when absent the titlebar registration is skipped and route + mini-player remain.
   - `host.navigate` was called unguarded in popover shortcuts. Now `HOST_NAVIGATE` is feature-detected; view-switching shortcuts still work in-pane, the navigate-only shortcut is disabled with an explanatory title.
3. **Incompatible-host recovery stays precise and data-safe:** the fallback alert lists the missing exports AND the required contract version, states saved data is untouched, and returns before any controller/polling/request/storage access (fixture-proven).
4. **Compatibility documentation:** NEW `docs/handoffs/agent-plan/COMPATIBILITY.md` — the full door inventory (public SDK namespace, ctx doors, plugin-owned embed-host document vs host DOM, owned Spotify backend, feature-detected window doors), N/N+1 strategy, non-guarantees, recovery behavior and the audit result. `manifest.json` intentionally unchanged (no speculative host-schema fields).
5. **Audit confirmed clean:** no deep/private Hermes imports, no sibling-plugin imports, no named-ESM SDK bindings, no host DOM selectors, no app.asar/source-path patching; `window.hermesDesktop?.getEmbedHostOrigin` and `window.Spotify?.Player` remain optional-chained; `youTubeWatchCapability` reports exact missing contracts.

## 2. Fixtures

`tests/sdk-boundary.test.mjs` extended (6 → 13 tests): HOST_CONTRACT consistency; N+1 namespace with extra unknown exports ignored; absent Button/navigate/titlebarRight preserve compatibility with precise capability projection; raw-Button trap regression + guarded registration/navigation statics; incompatible fallback precedes any controller and touches no storage/polling/requests; owned-view capability present/absent/partial/null; single-public-door/no-private-coupling statics. All headless labelled SDK doubles — packaged-host rendering remains FM-25.

## 3. Changed files

- `desktop/src/00-runtime.js` — HOST_CONTRACT, resolveSdk optional projection, HOST_NAVIGATE/TITLEBAR_RIGHT guarded constants.
- `desktop/src/44-workspace.js` — guarded titlebar summary button, guarded titlebar registration, feature-detected navigation, contract-naming fallback alert.
- `desktop/plugin.js` — regenerated (`--check` clean, ESM OK).
- `tests/sdk-boundary.test.mjs` — extended.
- `docs/handoffs/agent-plan/COMPATIBILITY.md` — NEW.
- This receipt.

## 4. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **186 tests, 186 pass, 0 fail, 0 cancelled** (two consecutive full runs).
- `.venv/bin/python -m pytest -q` → **142 passed** (backend untouched; regression guard).
- `python3 scripts/build_desktop.py --check` → bundle in sync, clean.
- `node --input-type=module --check < desktop/plugin.js` → ESM syntax OK.
- Serial lightweight suite only; no downloads/Docker/paid calls/live providers.

## 5. Fixture versus live evidence

Contract/capability fixtures use labelled SDK doubles and static bundle anatomy. NOT proven here: real packaged-Desktop rendering with an actual next Hermes build, real titlebar/pane registration on a live host, real owned-view capability negotiation. Those remain explicit FM-25 owner acceptance. Unknown arbitrary future breaking releases are explicitly not guaranteed.

## 6. Protected paths (untouched)

.env/auth/token stores, real plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, provider transport semantics, backend modules, manifest.json host schema, legacy raw preservation, historical docs, FM-20..FM-22 behavior (all prior fixtures pass).

## 7. Remaining acceptance and next card

- Owner packaged-host compatibility/rendering review: FM-25 (t_0bbb3bc2).
- Commit SHA/parent/author and verified remote SHA: recorded in the CALLBACK FINISH comment.
- Next existing card: FM-24 (t_e8abaa89) — complete cloud-to-Desktop artifact and stale-doc reconciliation.
