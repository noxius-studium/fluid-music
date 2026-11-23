# FluidMusic 0.5.1 — owner install note

Patch release over 0.5.0. Install this archive over the previous plugin version,
then restart Hermes Desktop so the backend module set is reloaded.

## What changed

- The release archive now contains **every** backend Python module. 0.5.0 was
  built from a hand-maintained file list and omitted `dashboard/providers/local_settings.py`
  and `dashboard/youtube_audio_fallback.py`; that made `/settings`,
  `/spotify/auth/start` and the audio fallback fail with a transport error in
  the installed plugin even though they worked in the source tree.
- Switching playback away from Spotify no longer aborts when the old source
  cannot be paused (e.g. during a backend reload).
- CI verification is green on Linux and Windows; UI fixtures match the current
  plugin surface.

## Nothing else changed

Spotify still uses your own public Client ID and PKCE (no client secret). No
tokens, credentials, media or databases are shipped in the archive.
