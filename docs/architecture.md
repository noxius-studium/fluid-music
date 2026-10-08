# FluidMusic architecture

## Design goal

FluidMusic presents one music workflow while keeping three playback engines honest:

```text
FluidMusic coordinator
├── Spotify adapter ──> Spotify Web/Connect APIs ──> selected Spotify device
├── radio adapter ──> Radio Browser metadata ──> internal HTMLAudioElement
└── local adapter ──> SQLite catalog ──> Hermes seekable media protocol
```

The coordinator owns queue order and source handoff. Each adapter owns its actual playback state, capabilities, and error meanings.

## Unified package

```text
fluid-music/
├── plugin.yaml
├── dashboard/
│   ├── manifest.json
│   ├── plugin_api.py       # Spotify, radio, and local-library HTTP routes
│   └── local_library.py    # SQLite repository and bounded scanner
├── desktop/
│   └── plugin.js           # route, navigation, workspaces, queue, and player
└── docs/
```

The backend mounts under `/api/plugins/fluid-music/`. The desktop contribution reaches only that namespace through `ctx.rest`.

## Application scope

`createController(ctx)` is created once during plugin registration, not in a route component. It owns:

- normalized queue and active index;
- source handoff sequencing and stale-transition invalidation;
- internal radio/local audio elements;
- Spotify polling and provider state;
- FluidMusic playlists;
- hydrated local roots/tracks;
- disposal of timers, media elements, object URLs, and audio nodes.

Route navigation can unmount workspace components without stopping playback.

## Normalized queue

Every queue item has a `source` discriminator. Provider-specific stable references remain separate:

- `spotify`: Spotify URI and catalog metadata;
- `radio`: validated public HTTPS stream URL;
- `local`: stable SQLite `localTrackId`, resolved runtime path, and availability.

The coordinator stops the previous engine before starting the next. A command being issued is not treated as provider-confirmed playback.

## Persistent local library

### Authority and storage

The Python backend owns local-library truth. Its database is resolved at request time from the active profile:

```text
$HERMES_HOME/plugin-data/fluid-music/library.sqlite3
```

This avoids cross-profile leakage when one Hermes process serves more than one profile.

The schema contains `scan_roots` and `local_tracks`. It stores approved roots, canonical paths, stable IDs, metadata, fingerprints, availability, and timestamps. It never stores media bytes or credentials.

### Scanning

A root must be an absolute, existing, readable directory selected or entered by the user. The scanner:

1. walks only configured roots and does not follow directory symlinks;
2. accepts a fixed audio-extension allowlist;
3. stops at a 50,000-track safety bound per scan;
4. fingerprints the file size plus bounded first/last chunks;
5. upserts available files transactionally;
6. marks unseen files unavailable rather than deleting them.

When one missing catalog row has the same fingerprint as a newly discovered path in the same root, the row is relinked and retains its stable track ID. Ambiguous matches become distinct tracks rather than guessing.

### Playback

The renderer never gets Node integration or arbitrary filesystem APIs. The backend returns paths only for cataloged files under approved roots. The controller converts those paths into the existing `hermes-media://stream/` or remote-proxy candidates. Hermes' media protocol validates readability and supports HTTP byte ranges, so local playback can seek without loading the whole file into renderer memory.

### Playlist references

FluidMusic playlist state stores only `localTrackId` and display metadata for local items. Raw filesystem paths and runtime playback URLs are stripped before persistence. At startup, `refreshLocalLibrary()` hydrates those references from SQLite. Missing tracks remain visible as unavailable and can recover after rescan.

This is what allows a playlist to persist this sequence safely:

```text
local-track-id → spotify:track:… → radio-station → local-track-id
```

## Spotify

Hermes' bundled `SpotifyClient` remains the credential and refresh authority. FluidMusic never exposes OAuth tokens to the renderer. The backend provides:

- PKCE status/start routes;
- `/me/player/devices` discovery and active-device fallback;
- playback, seek, volume, transfer, queue, shuffle, and repeat routes;
- paginated search;
- current-user playlists;
- playlist items through `/playlists/{id}/items`.

Spotify audio always remains on a Spotify Connect device.

### Queue ownership and progress

An individual Spotify track starts with its retained album/playlist context and selected-track offset when catalog metadata supplies that context; otherwise it uses the documented `uris` payload. The controller separately records an expected track guard. When local projection reaches the duration, Spotify reports the track ended, or Spotify reports a different URI after confirming the expected one, the controller advances the FluidMusic queue exactly once.

The **Let Spotify continue after a track** setting disables that guard. Spotify may then continue inside its context or recommendations without changing the selected FluidMusic queue item.

Authoritative Spotify snapshots are bounded to no more often than every 8 seconds while the workspace is open and 20 seconds while closed. Between snapshots, a 500 ms local clock projects elapsed position from the last position, duration, playback state, and receipt time. The local clock makes no network calls; later snapshots correct any drift.

### Expandable Spotify playlists and copies

Queued Spotify playlists remain provider contexts. Their expanded track rows carry the original page position before unsupported entries are filtered; selecting a duplicate song sends a numeric context offset, not the first matching URI. The controller resolves the original queue object again after asynchronous work, so removing or moving a duplicate context does not select another occurrence.

The save dialog explicitly distinguishes copying individual songs from retaining one Spotify playlist reference. Collection copies resolve every page (up to 10,000 entries) before committing a destination. Cancellation, provider failure, stalled pagination, or a deleted destination cannot publish a partial copy or an empty new playlist. Copies preserve duplicates/order and strip the source playlist context so they remain independently editable. The controller checks stored state before acknowledging success.

## Audio analysis and continuity

Indexed playback uses the existing host transport without attempting Web Audio access. Browser-opened File/blob audio and compatible CORS radio can use real analysis. No custom-scheme permissions or Hermes host code are modified.

For analysis-capable audio, `source → gain → destination` stays connected for the lifetime of the engine. An analyser is a separate source tap with no speaker output. Visibility leases connect/disconnect only that tap; they never reroute the audible path. Volume changes use a short AudioParam ramp. Hidden/reduced-motion visuals do no sample work. This does not promise gapless provider handoff or eliminate network/device buffering.

## Search

Spotify API results are normalized into track rows and album/artist/playlist cards.

## Capability matrix

| Capability | Spotify | Radio | Local |
| --- | --- | --- | --- |
| Play/pause | Connect command | Internal audio | Internal audio |
| Previous/next | Connect contexts + app queue tracks | App queue, not station skipping | App queue |
| Seek | Connect | No | Yes |
| Volume | Connect | Internal | Internal |
| Shuffle/repeat | Connect | No | No |
| Audio analyser | No decoded audio | When CORS permits | Browser-opened session files only; not indexed transport |

## Theme and accessibility

FluidMusic chrome derives from Hermes `--ui-*` variables and `color-mix(...)`. App icons use SVG paths, never emoji. Essential actions are visible and keyboard reachable, focus rings use the active accent, container queries respond to the actual pane width, and reduced-motion preference disables visualizer processing as well as transitions. Dialogs trap focus through native `dialog`, focus their form field on open, and restore focus on close.

## Security boundaries

- OAuth and provider tokens remain in Hermes credential stores.
- SQLite contains no credentials, cookies, object URLs, or audio bytes.
- Radio inputs accept only public credential-free HTTPS streams and are not backend-proxied.
- Local scanning is rooted in explicit user approvals and renderer Node integration remains disabled.
