# FM-10 receipt — Spotify devices, real transport and honest in-plugin playback capability

Task: FM-10 (t_9320fcb4) · Board: fluid-music · Card: `kanban/FM-10.md`
Requirements: F23, F24, F25, F29, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: ebbafd649765d52fe5190bcf18f0333e4aaebda2 (remote read-back equal; tree clean).

## 1. What was built

Backend (owned provider, FM-09 foundation):
- `user-read-private` scope added; account binding now stores `product` (premium/free) from `/me` — the ONLY backend-knowable eligibility signal.
- NEW `GET /spotify/local-capability`: returns account_product plus explicitly `unverified` sdk / encrypted_media / provider_approval / local_audio fields and `connect_control: true`. It NEVER certifies decoded in-plugin audio; Connect control availability is reported separately from local audio.
- Transport routes retained and proven: play (context_uri + offset position + exact duplicate uris, 1–50 bound), pause/next/previous, volume/seek (finite out-of-range values CLAMP to official bounds before sending — established contract; non-finite/missing rejected before any provider call), shuffle/repeat (enum-validated), queue add, transfer (device_ids + play), devices discovery. URI format validated (`spotify:` prefix, length bound) before any provider request.

Renderer:
- `classifySpotifyFailure` (pure): distinct reasons/actions/remedies for auth-required (401), rate-limited (429), forbidden (403), no-device (410 / device-text 404), not-found (404), transient (5xx), undetermined (never mislabelled). Retryability explicit per reason.
- `spotifyLocalPlaybackCapability` (pure): official Web Playback SDK requirements — Premium account, SDK presence, encrypted-media (Widevine) in the ACTUAL runtime, provider approval. States: ineligible-account / unsupported-runtime / unverified / **eligible-unproven** (best possible without owner audio proof; `localAudio: null` — passing checks is NOT decoded-audio evidence). No state ever claims full local audio silently.
- Controller: `spotifyFailure` atom set on playback-state/device-discovery errors (cleared on confirmed state; existing user-facing message copy unchanged), `spotifyLocalCapability` atom + `assessSpotifyLocalPlayback()` — fetches account product, feature-detects `window.Spotify.Player` and `navigator.requestMediaKeySystemAccess('com.widevine.alpha')` with guarded failure; headless runtimes honestly report unverified.
- Settings SpotifyConnection card: honest `In-plugin audio: <state> — <reason>` line + explicit "Check local playback" action. Copy keeps "Playback stays on your chosen Spotify device" (Connect semantics, not local-audio promise).
- One active source preserved: Spotify→radio handoff pauses the provider through the coordinator before the new engine starts; no Spotify play command after handoff; exactly one live engine.

## 2. Web Playback SDK assessment (honest, evidence-gated)

Official requirements: Premium account; encrypted-media/Widevine CDM in the packaged runtime; SDK loaded from Spotify; **prior written Spotify approval for commercial use** (PROVIDER_RESEARCH). This cloud host has no packaged Electron/browser runtime to prove EME or decoded audio, and no provider approval exists. Therefore:
- Connect remote control = implemented and fixture-proven (payloads below).
- In-plugin streaming = capability adapter delivered; best honest state on a fully-passing runtime is `eligible-unproven`. Actual decoded audio, Widevine in the owner's packaged Desktop, and commercial approval remain explicit owner gates (FM-25). Unsupported runtimes are surfaced as `unsupported-runtime`, never silently certified.
- No pseudo-engine, no extra Hermes plugin, no substitute "local audio" claim.

## 3. Tests (bounded doubles; zero real credentials/network)

- `tests/test_spotify_transport.py` (NEW, 12): route-level through the OWNED SpotifyClient + httpx.MockTransport — actual outgoing PUT/POST payloads (context offset, exact duplicate uris, device_id targeting, volume/seek params, shuffle/repeat states, queue uri, transfer body, auth headers); rejected inputs never reach the provider; finite out-of-range clamps to 100/0 before sending; 403/429/500/503 status distinctions; 404 vs 410 distinct; expired token refreshes IDEMPOTENTLY across sequential requests (exactly one token call); token-bearing provider error text sanitized; local-capability route honesty.
- `tests/spotify-transport.test.mjs` (NEW, 5): classifier matrix (7 distinct reasons incl. unknown); capability checker never certifies audio; device-discovery failures surface distinct classified remedies (429/403/410/500); assessment combines product + runtime detection (eligible-unproven / unsupported-runtime / ineligible-account); Spotify→radio handoff payload order + single live engine.
- Harness contract: all 7 node harnesses inject the two new pure helpers (no stale factory drift). `test_spotify_owned.py` account assertion updated for the intentional `product` field addition.
- Fixture engineering note: Node ≥22 exposes `globalThis.navigator` as getter-only; harness globals swap via property descriptors (install AND restore) — plain assignment threw and stalled the runner.

## 4. Checks and ACTUAL results

1. `.venv/bin/pytest tests/ -q` → **114 passed, 0 failed** (102 prior + 12 new).
2. `node --test tests/*.test.mjs` → **111 tests, 108 pass, 3 fail** — the 3 are exactly the pre-existing stale string assertions (navigation destinations, workspace shipped-surface list, discovery copy) deferred to FM-13/18/24.
3. `build_desktop.py` + `--check` exit 0; bundle ESM syntax OK.
4. ruff: providers/, new tests, package.py → **All checks passed**; plugin_api.py unchanged 5 pre-existing findings, zero new.

## 5. Honest boundaries

- ZERO real Spotify network/account operations; all transport evidence is MockTransport + temp homes + labelled EME/SDK doubles.
- Real Connect playback on owner devices, Web Playback SDK decoded audio, Widevine in packaged Electron, Premium eligibility on the owner account and commercial approval: explicitly UNVERIFIED (FM-25).
- Volume clamping semantics preserved (FM-12 owns the unified transport/volume UX); no baseline contract changed.

## 6. Protected work (untouched)

.env/auth/credential stores (legacy unmigrated), runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 108 node passes + 114 pytest requirements, FM-11 catalogue scope, FM-18 Settings card expansion, FM-12 transport unification.

## 7. Downstream

FM-11 (next): Spotify catalogue/library/playlist workflows. FM-12: unified bottom transport + usable volume everywhere. FM-18: Settings connection-card states (consumes spotifyFailure/spotifyLocalCapability). FM-23: adapter formalization. FM-25: owner live Connect/local-audio review.
