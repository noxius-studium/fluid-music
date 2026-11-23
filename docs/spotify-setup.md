# Spotify setup (FluidMusic)

FluidMusic owns its Spotify connection. Setup is one-time, uses official
Authorization Code + PKCE, and needs no client secret or separate Hermes
Spotify plugin. Premium is required for remote playback control through
Spotify Connect.

1. Open https://developer.spotify.com/dashboard and sign in with the account
   you want FluidMusic to control.
2. Create an app. Name and description can be anything; the app is yours.
3. Under **Redirect URIs**, add exactly:
   `http://127.0.0.1:43827/spotify/callback`
   (loopback only — no public server, no wildcard, no trailing path).
4. Copy the app's **Client ID** (this is public by design for PKCE; do not
   paste a client secret anywhere in FluidMusic).
5. In FluidMusic: Settings → Providers → **Spotify Client ID** → paste it →
   **Save Client ID** → **Connect Spotify**. Complete sign-in in the browser
   window that opens. FluidMusic never sees or stores your password.
6. After connecting, choose an available device in the same card. The shared
   bottom bar then drives that Connect device. A Spotify free account cannot
   be remote-controlled; in-plugin decoded audio depends on the host's Web
   Playback support and remains an explicit review boundary.

## Storage and safety

- The Client ID is a non-secret, profile-local preference. Tokens live in a
  separate protected credential file under `plugin-data/fluid-music`, never in
  SQLite history, renderer storage, logs or exports.
- FluidMusic's disconnect action clears its own local tokens without touching
  other plugins or provider integrations.
- The setup value is validated (letters, digits, `_`, `-`, max 128 chars). A
  missing or invalid ID shows an honest setup state, never a fake Connected
  badge. If the browser callback cannot reach the loopback port, confirm no
  other app owns 43827 and retry.
- Playback is owned by FluidMusic's single coordinator. OAuth and URL fetches
  do not stop the current engine (see the desktop-only assessment in
  FM-29 / `docs/limitations.md`).
