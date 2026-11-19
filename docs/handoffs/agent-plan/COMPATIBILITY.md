# FluidMusic host compatibility contract (FM-23)

Written: 2026-11-19 (UTC) · Contract version: 1 · Branch: docs/cloud-kanban-handoff
This document declares the REAL host doors FluidMusic uses. It is a contract
for the current and next SDK shape, not a guarantee about arbitrary future
breaking releases.

## 1. The only host door: the public plugin SDK namespace

`desktop/src/00-runtime.js` imports `* as HermesSDK from '@hermes/plugin-sdk'`
and capability-checks BEFORE referencing any export (`SDK_BOUNDARY` region).
A missing named ESM binding therefore cannot abort the plugin at link time.

Required exports (host contract v1): `atom`, `useValue`, `host`, `ROUTES_AREA`,
`TITLEBAR_AREAS`. If any is missing, registration renders an honest recovery
surface listing the missing exports and the required contract. In that path
NO controller is created, NO media command, polling or storage write happens,
and saved data is never deleted or rewritten.

Optional exports and their declared fallbacks:

| Door | Absent behavior |
|---|---|
| `Button` | WorkspaceButton and the titlebar summary render a plain `button` with the same actions/labels |
| `host.navigate` | In-pane view switching still works; the navigate-only shortcut is disabled with an explanatory title |
| `TITLEBAR_AREAS.right` | Titlebar registration is skipped; route and mini-player remain |
| `OwnedMediaView` + `host.mediaSession` | First-party YouTube watch fallback reports the exact missing capability; embed engine and all other sources remain |
| `window.hermesDesktop.getEmbedHostOrigin` | Feature-detected; falls back to the direct embed URL |
| `window.Spotify.Player` | Feature-detected; in-plugin Spotify audio assessed as unsupported, Connect control remains |

React (`createElement`, hooks, `jsx-runtime`) is a stable platform dependency,
not an optional host export.

## 2. Plugin-owned surfaces (not host coupling)

- Backend: `dashboard/plugin_api.py` + `dashboard/local_library.py` +
  `dashboard/providers/spotify.py` (FluidMusic-owned Spotify; no Hermes-core or
  sibling-plugin provider import). `hermes_constants.get_hermes_home` is the
  public profile-scoping door.
- The YouTube embed-host HTML document (`/youtube/embed-host`) is plugin-owned
  loopback content with origin/Host checks; its `document.querySelector` runs
  inside THAT document, never against the host app DOM.
- Renderer DOM usage is limited to FluidMusic's own rendered tree (style
  injection, popover outside-click/Esc, focus restoration). No host DOM
  selectors, no private raw bridges, no source-path patch scripts, no
  hand-edited app.asar, no private Hermes monkeypatch.
- Persistence: host `ctx.storage` (queue/preferences/sessions) and profile-local
  SQLite via the backend (library/history/resume/bookmarks/settings). Versioned
  `user_version` migrations with bounded backup and rollback (FM-22).

## 3. Update resilience strategy (N/N+1)

- `tests/sdk-boundary.test.mjs` exercises the CURRENT complete namespace, a
  NEXT shape with extra unknown exports (ignored, still compatible), and
  ABSENT optional doors (Button/navigate/titlebarRight) plus missing core
  exports (precise incompatibility). `youTubeWatchCapability` fixtures cover
  present/absent/partial owned-view capability.
- Optional-capability-absent startup, disable/reload/disposal, stale async
  events and refresh races are covered by the focus/keyboard/disposal and
  recovery fixtures (FM-02/FM-19/FM-22).
- These fixtures do NOT prove compatibility with an unreleased host or real
  packaged-Desktop rendering; owner packaged-host acceptance remains explicit
  (FM-25). Unknown arbitrary future breaking releases are not guaranteed.
- Incompatible host state becomes precise recovery (the alert surface above),
  never silent deletion, silent provider substitution or rewritten scope.

## 4. Audit result (FM-23)

- No deep/private Hermes imports, no sibling-plugin imports, no named-ESM
  startup traps (namespace + capability check; raw optional `Button` usage in
  the titlebar summary replaced with a guarded fallback).
- `TITLEBAR_AREAS.right` and `host.navigate` are now feature-detected before
  use; registration degrades per the table above.
- `manifest.json` is intentionally NOT extended with speculative host fields;
  the contract is declared in code (`HOST_CONTRACT`) and this document.
