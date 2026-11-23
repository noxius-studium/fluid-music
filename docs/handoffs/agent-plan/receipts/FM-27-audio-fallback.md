# FM-27 receipt — real audio-only yt-dlp fallback (owner follow-up)

Task: FM-27 (t_b6e35f3d) · Board: fluid-music · Written: 2026-11-23 (UTC)
Owner basis: 2026-11-21 feedback items 2+3 ("there's no fallback" → implement a real one) + 2026-11-23 resume.
Profile: default · Provider: nous · Active route: tencent/hy4-flash:free. No delegation.
Repository: noxius-studium/fluid-music · Branch: docs/cloud-kanban-handoff
Baseline SHA: 7bea68e82f711966494398bda6698dc77c189759 (FM-26, verified ancestor).

## What changed

- `dashboard/providers/local_settings.py` (new): profile-local, NON-SECRET settings JSON (atomic, 0600) with a validated `music_dir`. No tokens/cookies/media.
- `dashboard/youtube_audio_fallback.py` (new): audio-only yt-dlp adapter. `bestaudio[ext=m4a]/bestaudio`, no playlist, bounded retries/timeout, no FFmpeg merge, no signed-URL logging; writes to the configured folder, registers it as a local-library root (idempotent rescan), returns the indexed `track_id`. Injectable `ydl_factory` for labelled fixtures.
- `dashboard/plugin_api.py`: `GET/PUT /settings` and `POST /youtube/fallback/audio` (validated URL, explicit "set a folder first" state, redacted provider errors).
- `desktop/src/30-controller.js`: `musicDir` atom + `loadSettings`, `setMusicDir`, `chooseMusicDir`, `downloadYouTubeAudioFallback`. The real fallback adds the indexed track Up Next; it never autoplays or starts a second engine.
- `desktop/src/44-workspace.js`: Settings → Playback → **Audio fallback folder** (text field, Browse via `pickOpenPath`, Save).
- `desktop/src/43-visualizer.js`: **Download audio** action on eligible failures (besides Retry / watch fallback / Skip).
- `desktop/src/20-styles.js`: `.fluid-inline-field` etc. `desktop/plugin.js` regenerated.
- `docs/limitations.md`: lean audio-fallback section + explicit personal-use ToS stance; non-goals reconciled.
- Tests: `tests/test_youtube_audio_fallback.py` (new), `tests/youtube-audio-fallback.test.mjs` (new), `tests/titlebar-mini.test.mjs` (3 controller tests).

## Checks (actual)

- `build_desktop.py --check` clean; ESM syntax OK.
- `node --test tests/*.test.mjs` → 194 pass / 0 fail / 0 cancelled (was 189 + 5 new).
- `.venv/bin/python -m pytest -q` → 151 passed (was 147 + 4 new).
- yt-dlp double proves the option shape (audio-only, no merge) and REAL LocalLibrary registration of a tiny labelled .m4a in an isolated temp DB. No live network/provider call, no owner media.

## Honest boundaries

Cloud fixtures prove validation, download-option shape, library registration, UI/route wiring and no-autoplay. Real yt-dlp download, live YouTube/account behavior, m4a decoding on the packaged Desktop and Windows folder access are NOT proven — owner review on the Desktop artifact. yt-dlp is an optional runtime dependency; if unavailable, the route reports a sanitized failure rather than faking success.

Next: FM-28 (t_28a18a5b) Spotify Client ID setting + setup guide.
