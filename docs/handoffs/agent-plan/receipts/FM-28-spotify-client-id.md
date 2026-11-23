# FM-28 receipt — Spotify Client ID setting + setup guide (owner follow-up)

Task: FM-28 (t_28a18a5b) · Board: fluid-music · Written: 2026-11-23 (UTC)
Owner basis: 2026-11-21 feedback item 4 ("There is no setting to do that, you forgot") + 2026-11-23 resume.
Profile: default · Provider: nous · Active route: tencent/hy4-flash:free. No delegation.
Repository: noxius-studium/fluid-music · Branch: docs/cloud-kanban-handoff
Baseline SHA: c643d2415936e51ba952b54855d3d96d515bc03a (FM-27, verified ancestor).

## What changed

- `dashboard/providers/local_settings.py`: public PKCE client id getter/setter with the same validation as the auth route (letters/digits/`_`/`-`, max 128). Non-secret, profile-local, atomic 0600 JSON — never a token or secret.
- `dashboard/plugin_api.py`: `GET/PUT /settings` now include `spotify_client_id` (fields independent); `/spotify/auth/start` uses the saved id when the request omits it, while an explicitly supplied invalid/empty id still fails exactly as before.
- `dashboard/providers/spotify.py`: `configured_client_id()` falls back to the owned setting, so Setup/connection status is honest after saving.
- `desktop/src/30-controller.js`: `spotifyClientId` atom, loaded from `/settings`, plus `setSpotifyClientId(value)` (PUT) and both exported.
- `desktop/src/41-library.js`: the Client ID field is ALWAYS visible (previously only on `needsClientId`), prefilled from the saved setting, with a real **Save Client ID** action, exact redirect URI, PKCE/no-secret and Premium notes. Connect uses the saved value.
- `docs/spotify-setup.md` (new, lean) added to the package docs allowlist: dashboard → app → redirect `http://127.0.0.1:43827/spotify/callback` → client id → connect; Premium note; storage/safety.
- Tests: `tests/test_spotify_client_id.py` (4 backend), `tests/spotify-client-id.test.mjs` (3 static), `tests/titlebar-mini.test.mjs` (1 controller); FM-27 route test updated for the new settings shape.

## Checks (actual)

- `build_desktop.py --check` clean; ESM syntax OK.
- `node --test tests/*.test.mjs` → 198 pass / 0 fail / 0 cancelled.
- `.venv/bin/python -m pytest -q` → 155 passed (incl. release-package allowlist/hash test).
- No live Spotify account, OAuth browser or paid call. Doubles only; the client id is public by design (PKCE).

## Honest boundaries

Fixtures prove validation, persistence, route wiring, always-visible UI and that the saved id satisfies one-time setup. Real Spotify dashboard/account, browser callback and Connect device behavior remain owner review.

Next: FM-29 (t_81236daa) playback-cutout / desktop-only assessment.
