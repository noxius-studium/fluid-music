# FluidMusic

[![CI](https://github.com/noxius-studium/fluid-music/actions/workflows/ci.yml/badge.svg)](https://github.com/noxius-studium/fluid-music/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/noxius-studium/fluid-music)](https://github.com/noxius-studium/fluid-music/releases)

[Releases](https://github.com/noxius-studium/fluid-music/releases) · [Architecture](docs/architecture.md) · [Limitations](docs/limitations.md) · [Contributing](CONTRIBUTING.md)

FluidMusic is a unified music application for **Hermes Desktop**. It combines Spotify Connect, internet radio, and a persistent on-device library without pretending those providers share one playback engine.

## What it provides

- A redesigned, pane-responsive Media workspace, persistent player dock, and movable mini-player pane.
- Status-bar volume, mute with volume restore, and an optional audio visualizer.
- Spectrum, waveform, and mirrored visualization styles for audio decoded by Hermes. Hidden visuals perform no sampling or animation work; the analyser disconnects when no visible visualizer needs it.
- One application-owned queue across Spotify, radio, and indexed local tracks.
- A master/detail playlist editor with create/rename/description, bulk additions, track search, reorder, play from a specific occurrence, append to queue, duplicate, bulk removal, deduplicate, and one-level destructive-edit undo.
- JSON playlist import/export and save-queue-as-playlist. Imports are validated and additive; existing collections are not replaced.
- Spotify search for songs, albums, artists, and playlists, plus the user's Spotify playlists and track details.
- Expandable Spotify playlists in the queue with exact song selection, including duplicate occurrences.
- Atomic saves of full Spotify playlists as editable song copies, or explicitly as single context references; retry/cancel never creates partial collections.
- Radio Browser discovery and direct internal radio playback.
- A profile-scoped SQLite local-library catalog with approved scan roots, stable track IDs, availability tracking, rescans, and move recovery.
- Theme-native SVG icons and Hermes theme variables throughout the FluidMusic chrome.

## Provider behavior

| Provider | Where playback happens | Important boundary |
| --- | --- | --- |
| Spotify | On the selected Spotify Connect device | FluidMusic sends remote-control commands; it does not decode Spotify audio. |
| Internet radio | Inside Hermes through browser audio | Stream availability, codecs, CORS, advertising, and station content remain controlled by the station. |
| Local music | Inside Hermes through the seekable `hermes-media` protocol | Only explicitly approved folders are scanned. Audio bytes remain on disk. |

FluidMusic does not download protected provider media, remove ads, bypass DRM, unlock Premium features, or override content restrictions.

## Installation

Install from this repository using Hermes:

```sh
hermes plugins install noxius-studium/fluid-music
```

Review the dependency and enablement prompts. For a reproducible installation, append `--ref <full-40-character-commit-SHA>` from a verified release. Alternatively, download the versioned ZIP from [Releases](https://github.com/noxius-studium/fluid-music/releases) and extract its `fluid-music` folder into the profile's `plugins` directory. Do not install an extra standalone desktop copy yourself; Hermes manages the unified package's desktop contribution.

The release archive contains one unified Hermes plugin folder:

```text
$HERMES_HOME/plugins/fluid-music/
├── plugin.yaml
├── dashboard/
│   ├── manifest.json
│   ├── plugin_api.py
│   └── local_library.py
└── desktop/
    └── plugin.js
```

`$HERMES_HOME` is profile-specific. Install the package in the profile that runs Hermes Desktop, enable **FluidMusic** under **Settings → Plugins**, then reload desktop plugins or restart Hermes Desktop.

## Spotify

1. Open **Media → Settings** or **Media → Spotify**.
2. Complete Hermes-managed Spotify PKCE authentication.
3. Open Spotify on a phone, computer, speaker, or browser under the same account.
4. Refresh devices and select a Spotify Connect device.

A connected Spotify account with zero available devices is valid. Library browsing still works, while playback waits for a Connect device.

## Persistent local library

Open **Media → Local music** and choose a folder. FluidMusic may also accept an absolute path when the music lives on the backend host.

The backend stores its catalog at:

```text
$HERMES_HOME/plugin-data/fluid-music/library.sqlite3
```

SQLite stores:

- approved scan-root paths;
- stable local-track IDs;
- canonical and relative paths;
- title, MIME type, size, modification time, and a bounded content fingerprint;
- availability and scan timestamps.

SQLite never stores audio bytes, OAuth credentials, browser object URLs, passwords, or provider tokens.

A rescan recursively indexes MP3, FLAC, M4A, AAC, WAV, Ogg, Opus, and WebM audio. If a file disappears, its catalog entry and playlist reference remain but are shown as unavailable. If the same file moves within an approved root, its bounded fingerprint allows FluidMusic to retain the stable track ID when the move is unambiguous.

Removing a scan root removes that root and its catalog rows. FluidMusic playlist references remain stable metadata; affected local entries become unavailable until the track is indexed again.

## Direct files and audio visualization

For local visualization, use **Media → Local music → Open audio files**, then Play beside an opened file. This grants the browser a file handle and makes real audio samples available without changing the indexed library. Opened files are session-only: they must be selected again after restarting Hermes and cannot be saved to persistent playlists. No full-file decoding or server upload is needed; browser audio streams the granted File.

The indexed library remains the persistent option and deliberately bypasses analysis. Its audio transport is not modified to grant Web Audio access; playback still works and the visualizer explains the direct-file option. Spotify Connect has no local audio samples. Radio analysis depends on the station's CORS policy.

## Mixed FluidMusic playlists

FluidMusic playlists are separate from Spotify playlists. A single FluidMusic playlist can contain:

- a local-track ID resolved through the SQLite catalog;
- a Spotify URI;
- an HTTPS radio entry.

The persisted local entry contains only the stable local-track ID and display metadata—not a raw filesystem path or media URL. At startup, FluidMusic resolves that ID against the active profile's SQLite catalog before playback.

## Search

The **Search** workspace returns normalized Spotify song, album, artist, and playlist results through the Spotify Web API.

## Queue and controls

The queue preserves provider order, but controls remain capability-driven:

- Spotify exposes Connect transport, seek, volume, shuffle, repeat, and device state where accepted by Spotify.
- Local playback exposes seek, volume, previous, and next.
- Radio exposes play/pause and volume, not fake seeking or station-content skipping. Select another queue item to switch sources.

By default, completing a Spotify track advances to the next FluidMusic queue item. The **Let Spotify continue after a track** setting instead leaves continuation to Spotify's active context or recommendations. Spotify progress is interpolated locally between authoritative snapshots, so the visible elapsed and remaining time advance smoothly without polling Spotify every second.

## Development and verification

The desktop implementation is maintained as nine focused source fragments:

- `desktop/src/00-runtime.js` — Hermes/React imports and constants
- `desktop/src/10-model.js` — queue models, validation, and pure provider payloads
- `desktop/src/20-styles.js` — theme-aware styling and shared UI primitives
- `desktop/src/30-controller.js` — provider adapters, transitions, polling, and diagnostics
- `desktop/src/40-ui.js` — shared rows, dialogs, volume, transport, and player dock
- `desktop/src/41-library.js` — overview, Spotify catalog/library, radio, and local folders
- `desktop/src/42-playlists.js` — playlist editor, bulk picker, import/export, and queue page
- `desktop/src/43-visualizer.js` — visible-only audio visualization and dockable mini-player
- `desktop/src/44-workspace.js` — navigation, settings, diagnostics, status bar, and registration

Hermes loads disk contributions through a blob URL, so relative browser imports are not reliable. `desktop/plugin.js` is the generated runtime entrypoint. Edit the fragments, then rebuild it:

```bash
python scripts/build_desktop.py
python scripts/build_desktop.py --check
```

The in-app **Logs** page records sanitized provider commands, response status, selected device suffixes, failures, and meaningful Spotify playback-state changes. It never stores OAuth credentials or tokens.

Full verification:

```bash
python -m pip install --require-hashes -r requirements-dev.txt
npm ci
python scripts/build_desktop.py --check
python -m pytest -q
python -m ruff check dashboard tests scripts
python -m compileall -q dashboard scripts
node --check desktop/plugin.js
npm test
npx playwright install chromium
npm run test:ui
npx --no-install esbuild desktop/plugin.js --bundle --format=esm --platform=browser \
  --external:@hermes/plugin-sdk --external:react --external:react/jsx-runtime \
  --outfile=.hermes-tests/plugin.bundle.js
hermes plugins validate . --json
python scripts/package.py
```

The package is ready only after those checks and live Hermes Desktop acceptance cover local restart persistence, a mixed local/Spotify playlist, Spotify library details, Spotify-to-Hermes queue handoff, locally interpolated progress, source-aware controls, and active-theme rendering.

## License

FluidMusic is licensed under the [Attribution-NonCommercial 4.0 International](LICENSE).
