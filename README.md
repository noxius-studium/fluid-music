# FluidMusic

[![CI](https://github.com/noxius-studium/fluid-music/actions/workflows/ci.yml/badge.svg)](https://github.com/noxius-studium/fluid-music/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/noxius-studium/fluid-music)](https://github.com/noxius-studium/fluid-music/releases)

[Releases](https://github.com/noxius-studium/fluid-music/releases) · [Architecture](docs/architecture.md) · [Limitations](docs/limitations.md) · [Contributing](CONTRIBUTING.md)

FluidMusic is a unified music application for **Hermes Desktop**. It coordinates Spotify Connect, internet radio, a persistent on-device library, and YouTube playback inside one capability-protected player, without pretending those sources share one playback engine.

## What it provides

- A Night Radio Media workspace with a circular artwork/record focal object and compact Browse, Library, Queue, and Settings navigation.
- One persistent application controller, a titlebar quick-control popover, and an optional dockable mini-player. Route and chat-focus changes do not own or reset playback.
- YouTube search and watch-URL entry with real titles, played inside the FluidMusic player through a capability-protected loopback embed host; an optional first-party watch fallback is offered only when the host actually provides the owned-view capability.
- One restart-restorable application queue across Spotify, radio, indexed local tracks, and safe YouTube entries. Session-opened files are intentionally omitted at restart.
- Local-only FluidMusic collections with edit/reorder/export workflows. Existing v3 mixed playlists remain visible as read-only Legacy mixes with play, enqueue, and export.
- Spotify search for songs, albums, artists, and playlists, plus the user's Spotify playlists and track details.
- Expandable Spotify playlists in the queue with exact song selection, including duplicate occurrences.

- Radio Browser discovery and direct internal radio playback.
- A profile-scoped SQLite local-library catalog with approved scan roots, stable track IDs, availability tracking, rescans, and move recovery.
- Theme-native SVG icons and Hermes theme variables throughout the FluidMusic chrome.

## Provider behavior

| Provider | Where playback happens | Important boundary |
| --- | --- | --- |
| Spotify | On the selected Spotify Connect device | FluidMusic sends remote-control commands; it does not decode Spotify audio. |
| Internet radio | Inside Hermes through browser audio | Stream availability, codecs, CORS, advertising, and station content remain controlled by the station. |
| Local music | Inside Hermes through the seekable `hermes-media` protocol | Only explicitly approved folders are scanned. Audio bytes remain on disk. |
| YouTube | Inside the FluidMusic player pane via the capability-protected embed host | Embedding restrictions remain the provider's; the optional first-party watch fallback needs a verified host owned-view capability. No DRM/ad/entitlement bypass. |

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

`$HERMES_HOME` is profile-specific. Install the package in the profile that runs Hermes Desktop, enable **FluidMusic** under **Settings → Plugins**, then reload desktop plugins (restart Hermes Desktop only if your host requires it). A Linux/cloud development workspace is provenance for building and verifying the artifact — it is not the Desktop install location, and cloud paths never appear in runtime instructions.

## Spotify

1. Open **Media → Settings → Providers**.
2. Enter your public Spotify Client ID and use **Connect Spotify**. FluidMusic ships and owns this PKCE integration; no separate Spotify plugin is required. Tokens stay in FluidMusic's protected profile-local store, never in the renderer or public library database.
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

## Direct session files

Use **Media → Library → Local music → Open audio files** to play a file without indexing its folder. Opened files are session-only: select them again after restarting Hermes. They cannot be saved to persistent collections.

FluidMusic no longer includes a visualizer or analyser settings. This does not change radio or local audio playback.

## Collection ownership

New FluidMusic collections are local-only and store local-track IDs resolved through the SQLite catalog. Spotify playlists remain provider-owned live contexts, radio persistence is pinned stations, and Up Next is the temporary/restart-restorable cross-source list. Existing mixed v3 playlists are preserved without rewriting as read-only **Legacy mixes**.

The persisted local entry contains only the stable local-track ID and display metadata—not a raw filesystem path or media URL. At startup, FluidMusic resolves that ID against the active profile's SQLite catalog before playback.

## Browse and YouTube

The **Browse** workspace combines Spotify search, radio discovery, and YouTube search/URL entry. YouTube results play inside the same FluidMusic player through the backend's 127.0.0.1-only, capability-token embed host with strict origin/Host checks and an official command/state relay. When a video refuses embedding but works on the normal watch page, FluidMusic offers a first-party watch fallback **only if** the host exposes the verified owned-view capability; otherwise it reports the exact missing contract and offers Retry/Skip. Exactly one engine is active at a time, and queue/history events stay single-owner across any engine switch. FluidMusic never inspects the focused chat preview, never claims access to signed-in recommendations, and never bypasses embedding, DRM, or entitlement restrictions.

## Listening sessions, resume and recovery (0.5.0)

- **Queue editing:** Play next, Add to end, multi-select remove/move, clear-upcoming vs clear-all (both confirmed), one-step undo, and "Added from search/history/collection/provider/library" provenance captions. Queue actions never edit provider-owned playlists.
- **Listening sessions:** named snapshots of safe source references. Restore previews unavailable items and asks Replace/Append inside the dialog; nothing autoplays.
- **Resume and bookmarks:** eligible long-form YouTube/local items (10 minutes or longer) offer explicit Resume/Start over and timestamp bookmarks. LIVE radio is never treated as seekable.
- **History discovery:** title/source/date filters, stable pagination, per-entry removal, scoped clear, and an explicit retention preference (Settings → Playback).
- **Sleep timer:** 15/30/60 minutes, custom 1–720, or end-of-item where supported; remaining time and Cancel live in the shared player. Changing the source cancels the timer — it never takes over another device later.
- **Recovery center:** Settings → Recovery shows evidence-based source health with bounded Retry/Skip/Reconnect/Rescan and sanitized copy-diagnostics. Retries cool down after three attempts; there is no fake all-online badge.
- **Host compatibility:** the declared contract and optional-door fallbacks live in [docs/handoffs/agent-plan/COMPATIBILITY.md](docs/handoffs/agent-plan/COMPATIBILITY.md). Unknown future breaking Hermes releases are not guaranteed; an incompatible host gets a precise recovery surface and saved data is never deleted.

## Queue and controls

The queue preserves provider order, but controls remain capability-driven:

- Spotify exposes Connect transport, seek, volume, and device state where accepted by Spotify.
- Local playback exposes seek, volume, previous, and next.
- Radio exposes play/pause and volume, not fake seeking or station-content skipping. Select another queue item to switch sources.
- YouTube exposes play/pause, seek, volume, previous, and next for the selected item through the embed host's official relay (or the capability-gated first-party watch surface).

By default, completing a Spotify track advances to the next FluidMusic queue item. The **Let Spotify continue after a track** setting instead leaves continuation to Spotify's active context or recommendations. Spotify progress is interpolated locally between authoritative snapshots, so the visible elapsed and remaining time advance smoothly without polling Spotify every second.

## Development and verification

The desktop implementation is maintained as nine focused source fragments:

- `desktop/src/00-runtime.js` — Hermes/React imports and constants
- `desktop/src/10-model.js` — queue models, validation, and pure provider payloads
- `desktop/src/20-styles.js` — theme-aware styling and shared UI primitives
- `desktop/src/30-controller.js` — provider adapters, transitions, polling, and diagnostics
- `desktop/src/40-ui.js` — shared rows, local-only save dialogs, volume, seek, and transport primitives
- `desktop/src/41-library.js` — overview, Spotify catalog/library, radio, and local folders
- `desktop/src/42-playlists.js` — playlist editor, bulk picker, import/export, and queue page
- `desktop/src/43-visualizer.js` — optional dockable mini-player pane (the filename is retained for build ordering; there is no visualizer or footer player)
- `desktop/src/44-workspace.js` — compact navigation, settings/diagnostics, titlebar control, and registration

Hermes loads disk contributions through a blob URL, so relative browser imports are not reliable. `desktop/plugin.js` is the generated runtime entrypoint. Edit the fragments, then rebuild it:

```bash
python scripts/build_desktop.py
python scripts/build_desktop.py --check
```

The **Settings → Diagnostics** view records sanitized provider commands, response status, selected device suffixes, failures, and meaningful Spotify playback-state changes. It never stores OAuth credentials or tokens.

Full verification (small, serial, within a modest memory budget — no browser farms or heavy installs):

```bash
python scripts/build_desktop.py
python scripts/build_desktop.py --check
node --input-type=module --check < desktop/plugin.js
node --test tests/*.test.mjs
python -m pytest -q
python scripts/package.py
```

The renderer fixtures read the generated bundle and exercise extracted regions with labelled headless doubles; the backend fixtures use isolated temporary SQLite. `tests/ui/verify.mjs` is a legacy optional browser suite (esbuild/Playwright/Chromium) whose expectations predate the current embed-host architecture; it is not part of the lightweight suite and is not required for release packaging.

The package is ready only after those checks and live Hermes Desktop acceptance cover restart-restorable Up Next state, immutable Legacy mixes, local-only collection writes, Spotify library details, Spotify/YouTube queue handoff, titlebar stability, source-aware controls, and active-theme rendering. Headless fixtures do not prove real sound, live YouTube embedding/consent, packaged Electron behavior, or live provider availability; those remain explicit owner acceptance.

## License

FluidMusic is licensed under the [Attribution-NonCommercial 4.0 International](LICENSE).
