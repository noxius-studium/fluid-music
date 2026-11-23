# FM-09 receipt — FluidMusic-owned Spotify OAuth, protected tokens and provider client

Task: FM-09 (t_70ce6ae3) · Board: fluid-music · Card: `kanban/FM-09.md`
Requirements: F23, F25, F29, F30, F31 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 32446aad0af6dfa582ca1e9aadf4ab603616e47c (remote read-back equal; tree clean).

## 1. What was built (plugin-owned, zero delegated imports)

New narrowly scoped modules:
- `dashboard/providers/__init__.py` — owned provider package.
- `dashboard/providers/token_store.py` — protected profile-local credential store: `HERMES_HOME/plugin-data/fluid-music/spotify-credentials.json`, **0600**, atomic temp+rename writes, profile home resolved at CALL time (per-profile overrides never bind stale), separate from the public SQLite history/library DB. Legacy stores are never read/copied/migrated.
- `dashboard/providers/spotify.py` — official **Authorization Code + PKCE (S256)**:
  - RFC 7636 verifier (43–128 chars) + base64url SHA-256 challenge; random `state`; loopback-only single-use callback (`127.0.0.1:43827/spotify/callback`, wrong path 404, replay 409); genuine provider page opened in the user's browser for consent (no password capture); declined/state-mismatch/timeout/bind-failure map to distinct sanitized error codes.
  - Token exchange + refresh against `accounts.spotify.com/api/token`; scopes: user-read-playback-state, user-modify-playback-state, user-read-currently-playing, user-library-read, playlist-read-private, playlist-read-collaborative, streaming, user-read-email.
  - Account binding via `/me` (id/display_name only); **single-flight refresh** under a lock (concurrent expiry ⇒ exactly one token request); one 401 retry; failed refresh clears credentials and reports reconnect — never fake Connected.
  - `SpotifyClient.request`/`get_playback_state` over `api.spotify.com/v1` with bounded timeouts, no redirects, sanitized errors (token-bearing/oversized provider text redacted); 204 → `{}`.
  - `logout`: best-effort provider revoke, then ALWAYS local removal.
  - `auth_status`: UI-safe whitelist only — raw tokens never leave the module (status, logs, renderer, exports).

Backend binding (`dashboard/plugin_api.py`):
- The legacy delegated loader (hermes_cli.auth / plugins.spotify / sibling `spotify-*` discovery) is **REMOVED**. `_load_spotify_integration()` now loads ONLY the owned package; the FM-01 lazy failure-isolated boundary is retained (provider import/auth failure never disables YouTube/radio/local/history; explicit unavailable envelopes).
- All route paths/shapes retained: /spotify/auth/status, /spotify/auth/start, /player, /devices, /play, /pause, /next, /previous, /volume, /seek, /transfer, /queue GET/POST, /shuffle, /repeat, /search, /playlists, /playlists/{id}/tracks. Auth-status whitelist gains safe `account` metadata; capabilities label now `plugin_owned_oauth_pkce`.
- `scripts/package.py` release list includes the three provider modules (release-archive test extended).

## 2. Tests (bounded doubles, zero real credentials/network)

- `tests/test_spotify_owned.py` (new, 11): PKCE verifier/challenge/authorize-URL contract; code exchange sends grant/code/verifier/redirect/client_id, stores 0600 tokens, binds account, status never contains raw tokens; callback state-mismatch/declined/timeout rejected with distinct codes and no stored credentials; missing login = disconnected + honest 401 (no HTTP); **4-thread concurrent expiry ⇒ exactly one refresh**; API 401 ⇒ one refresh + one retry; failed refresh clears store + disconnected; logout revoke success/failure both remove local credentials; two profile homes isolated; provider error sanitization; **static scan: no core/sibling Spotify implementation imports remain anywhere in dashboard/**.
- Existing suites re-targeted, requirements preserved: `test_plugin_api.py` api fixture now doubles the owned interface at the module boundary (no legacy sys.modules injections); `test_optional_provider_boundary.py` host-only scenario simulates provider-module absence via the loader (boundary machinery unchanged), available-path scenario resolves the owned provider then doubles it. All 33 legacy route/auth/transport/profile/release tests pass against the owned implementation.

## 3. Checks and ACTUAL results

1. `.venv/bin/pytest tests/ -q` → **102 passed, 0 failed** (91 prior incl. re-targeted doubles + 11 new).
2. `node --test tests/*.test.mjs` → **106 tests, 103 pass, 3 fail** (unchanged renderer; remaining 3 exactly the stale string assertions, FM-13/18/24).
3. `build_desktop.py --check` exit 0 (no renderer change this card).
4. ruff: `dashboard/providers/` + `scripts/package.py` → **All checks passed**; plugin_api.py now 5 findings (was 6; removing the legacy loader eliminated one pre-existing BLE001), zero new.

## 4. Honest boundaries (NOT fake completion)

- NO real Spotify credentials, network calls, logins or account operations were performed. All OAuth/token evidence is httpx.MockTransport + temp profile homes.
- Live OAuth consent, token refresh against the real provider, Connect playback, Web Playback SDK eligibility (Premium/encrypted-media/packaged Electron — FM-10 assesses) and commercial-use approval remain explicitly UNVERIFIED owner-side (FM-25; PROVIDER_RESEARCH §Spotify).
- A Spotify developer app Client ID is required for one-time setup; missing client_id/credentials is an honest setup/disconnected state surfaced through the existing setup flow — never fake Connected.
- Existing live legacy credentials (Hermes auth store / older plugins) remain UNMIGRATED and untouched until explicit owner sign-in/migration consent.
- The redirect URI `http://127.0.0.1:43827/spotify/callback` must be registered in the owner's Spotify developer app (documented setup step; bind failure is an honest error).

## 5. Protected work (untouched)

.env/auth/ALL existing credential stores, runtime plugin-data/SQLite/user media (fixtures used temp homes), Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 103 node passes + 91 pytest baseline requirements, FM-10 transport/device scope, FM-11 catalogue scope.

## 6. Downstream

FM-10 (next): Spotify devices, real transport, in-plugin playback capability assessment (Web Playback SDK vs Connect control). FM-11: catalogue/library/playlist workflows. FM-18: Settings connection card states. FM-23: adapter formalization. FM-25: owner live OAuth/playback review.
