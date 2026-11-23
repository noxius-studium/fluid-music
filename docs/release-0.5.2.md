# FluidMusic 0.5.2 — owner install note

Install this version over any earlier build and restart Hermes Desktop. A mixed
install (old backend + new UI) keeps failing on `/settings` even after 0.5.1,
because the loaded backend is not the one in the release archive.

## What changed

- **Diagnostics now shows the loaded build version** in its header
  (`Diagnostics · N · v0.5.2`). If it does not say `v0.5.2`, the old plugin is
  still loaded — uninstall every FluidMusic entry in Dashboard → Plugins,
  restart Hermes, then install this release and restart again.
- 0.5.1 already fixed the missing backend modules in the archive (`/settings`,
  Spotify auth start, audio fallback). This release makes the installed version
  verifiable on-screen.
- Backend source completeness and version identity are enforced by CI tests.

## Clean install checklist

1. Dashboard → Plugins: remove all FluidMusic entries (including old 0.4.x).
2. Restart Hermes Desktop completely.
3. Install `fluid-music-0.5.2.zip` from this GitHub release.
4. Restart Hermes Desktop again.
5. Open FluidMusic → Settings → Diagnostics; confirm the header says `v0.5.2`.

Spotify still uses your own public Client ID and PKCE — no client secret, no
tokens in diagnostics or the release archive.
