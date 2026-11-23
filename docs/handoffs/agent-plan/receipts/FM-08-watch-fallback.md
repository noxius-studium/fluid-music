# FM-08 receipt — owned first-party watch fallback: adapter delivered, host capability gap explicit

Task: FM-08 (t_40541fbd) · Board: fluid-music · Card: `kanban/FM-08.md`
Requirements: F08, F13, F14, F17, F18, F19, F32, F33, F39 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: f3655fea1b756d01a9b470b31ad0ef0df7cf876b (remote read-back equal; tree clean).

## 1. Capability evidence (verified on this host, source SDK)

The actual Hermes Desktop SDK source is present at `/opt/hermes/apps/desktop/src/sdk/index.ts` (1992 lines). Verified:
- The ONLY sanctioned external-content embed primitive is `SandboxedFrame` (export at line ~1760, component `src/components/ui/sandboxed-frame.tsx`): a sandboxed iframe with an **opaque origin**, default `allow-scripts`, and a strict sandbox-token ALLOWLIST that **deliberately excludes `allow-same-origin`** ("re-opens cookies and storage for the embedded origin — the opaque origin IS the containment") and the navigation/popup/modals family. Props are an explicit allowlist (no `allow`, `srcdoc`, `name`, `csp`, `credentialless` smuggling).
- The SDK comment states raw `<webview>` is rejected because it "would land on the app's own preview partition" — i.e. shared cookies with the app preview (a borrowed-session violation of this card's isolation contract).
- `host` exposes: state, settings, logs, completeMcpOAuth, navigate, deleteProfile, activeConnectionId, connections, agents, warmAgent. **No owned-view / webview / browser-surface / media-session capability exists.**
- Core state exports verified in source: `atom` (nanostores), `useValue` (@nanostores/react useStore), `ROUTES_AREA` re-export. (Packaged-host runtime compatibility remains a separate FM-23/FM-25 verification; source SDK ≠ packaged host.)

**Conclusion:** the current public SDK cannot mount/control an owned persistent first-party watch surface with genuine provider login inside FluidMusic. `SandboxedFrame` cannot be that surface: opaque origin ⇒ no provider cookies/storage ⇒ genuine login/consent/age verification impossible; it is still an iframe (first-party watch pages refuse cross-origin framing — owner-side runtime confirmation); no plugin control bridge into guest content. Using the focused-chat Browser, an external app, another plugin, a duplicate pane, or a private Hermes monkeypatch is prohibited and was NOT done.

## 2. The EXACT host contract required for full scope (the gap review)

For the host to enable the full FM-08 objective, the PUBLIC SDK must export (names are the contract FluidMusic negotiates against):
1. `OwnedMediaView` — a React component mounting a persistent webview-class surface INSIDE the existing FluidMusic player pane (same registration, not a new pane), with props: `src` (first-party watch URL), `sessionKey` (stable per-plugin/per-provider key), `title`, `className`, `ref` → control handle, `onMediaState(state)` callback.
2. `host.mediaSession` — `{ ensurePartition(pluginId, sessionKey), openLogin(controlHandle, providerUrl), dispose(sessionKey) }` providing a per-plugin ISOLATED cookie/storage partition (never the app preview partition, never another plugin's), genuine provider login inside that surface (no credential capture by the plugin), and lifecycle disposal.
3. Control handle: `{ play(), pause(), seek(ms), setVolume(0..1), getState(), dispose() }` bridging the REAL first-party page (host-implemented; the plugin never injects scripts into an opaque origin).
4. Guarantees: surface persists across route remounts; exactly one active engine per player; origin/Referer identity correct for the provider; no DRM/entitlement bypass; provider restrictions remain visible.

Until the host ships this contract, `youTubeWatchCapability(SDK)` reports `{available:false, missing:['OwnedMediaView','host.mediaSession']}` and the fallback is an honest unavailable state — never a hidden reduced-scope substitute.

## 3. What WAS implemented (plugin-owned adapter, fixture-proven)

- `desktop/src/10-model.js`: `youTubeWatchCapability(namespace)` — strict negotiation of the exact contract above; `SandboxedFrame` alone is explicitly NOT accepted.
- `desktop/src/30-controller.js`: `createController(ctx, hostCapabilities)` capability injection; per-item engine state (`embed`/`watch`) + bounded attempt budget (≤1 per transition, reset on each start); `attemptYouTubeWatchFallback()` — only for the selected YouTube occurrence with `fallbackEligible` (FM-07 matrix: 101/150/5/consent), capability-gated, visible 'Switching player…' + loading state, position and once-per-transition history flag preserved; engine-tag fencing in `reportYouTubeState` (late embed events cannot mutate watch state and vice versa); honest unavailable message when the capability is absent; no queue advance on recoverable errors; no external navigation anywhere.
- `desktop/src/44-workspace.js`: registration negotiates `youTubeWatchCapability(SDK)` and injects the result.
- `desktop/src/43-visualizer.js`: `OwnedWatchSurface` thin adapter over the required contract (sessionKey, control handle, engine-tagged state reports, dispose on unmount); MiniPlayer renders EXACTLY ONE engine (watch surface xor embed frame), watch-mode shared control bar via the control handle, explicit 'Try watch fallback' action alongside Retry/Skip; embed relay tags reports `engine:'embed'`.
- `desktop/plugin.js`: regenerated (`--check` exit 0; ESM syntax OK).
- Tests: `tests/youtube-watch-fallback.test.mjs` (new, 5): exact-contract negotiation (sandboxed-iframe substitute rejected); capability-absent honest unavailable + preserved embed path + zero Browser/external calls; labelled-fake-capability switch (visible switching state, occurrence preserved, late-event fencing both directions, exactly-one history across the switch, bounded attempts, no engine ping-pong); per-transition reset; either/or surface + dispose + no-scripting source contract. `tests/focus-continuity.test.mjs`: registration assertion updated for the capability-injection call shape.

## 4. Checks and ACTUAL results

1. Full `node --test tests/*.test.mjs` → **106 tests, 103 pass, 3 fail** (all 98 prior passes preserved + 5 new; remaining 3 exactly the stale string assertions, FM-13/18/24). Intermediate fixture failures (fake capability shape, registration regex, injected-vs-raw capability) were fixture bugs fixed to mirror registration exactly; product logic unchanged by those fixes.
2. `.venv/bin/pytest tests/ -q` → **91 passed** (unchanged; no backend change in this card).
3. `build_desktop.py --check` exit 0; bundle ESM syntax OK.

## 5. UNRESOLVED FULL-SCOPE GATE (explicit, not faked)

- The actual embed→watch fallback CANNOT function on any current Hermes host: the required public capability does not exist. This is an explicit unresolved full-scope acceptance gate, carried to FM-25 owner review.
- Owner/host decision needed: ship the §2 public contract (or an equivalent verified capability), then FluidMusic's adapter activates without private patches. What approval would authorize: host-side implementation of the owned-view contract; NOT a plugin-side workaround.
- Real failing-but-watch-eligible video proof, genuine provider login inside the owned surface, cookie isolation, controls and position retention on the packaged Desktop: all UNVERIFIED until the capability exists and the owner reviews (FM-25). The FM-07 live-evidence gate for the owner's actual failed videos also remains open.
- No all-videos promise is made; provider/account/geo/DRM restrictions remain in force.

## 6. Protected work (untouched)

.env/auth/credentials, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway (no restart, no monkeypatch, no private bridge), main/tags/releases, historical docs, unrelated files, the 98 prior node passes + 91 pytest baseline, FM-12 unification, FM-22 recovery, FM-09 Spotify ownership. No live YouTube/login/account operations, no paid calls.

## 7. Downstream

FM-09 (next): FluidMusic-owned Spotify OAuth/PKCE + protected tokens + provider client. FM-12: transport unification. FM-23: formal SDK adapter/N+N+1 fixtures (this card's negotiation is the seed). FM-25: owner review INCLUDING the host-capability decision and live evidence gates.
