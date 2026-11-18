# FluidMusic architecture

## Design goal

FluidMusic presents one music workflow while keeping four playback engines honest:

```text
FluidMusic coordinator
├── Spotify adapter ──> Spotify Web/Connect APIs ──> selected Spotify device
├── radio adapter ──> Radio Browser metadata ──> internal HTMLAudioElement
├── local adapter ──> SQLite catalog ──> Hermes seekable media protocol
└── YouTube adapter ──> owned validated watch page ──> page HTMLMediaElement
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
- local-only collections and preserved read-only legacy mixes;
- hydrated local roots/tracks;
- disposal of timers, media elements, object URLs, and audio nodes.

Route navigation and chat focus changes can unmount workspace components without stopping playback or changing queue selection. No playback state subscribes to `focusedSessionId` or `activeSessionId`.

## Normalized queue

Every queue item has a `source` discriminator. Provider-specific stable references remain separate:

- `spotify`: Spotify URI and catalog metadata;
- `radio`: validated public HTTPS stream URL;
- `local`: stable SQLite `localTrackId`, resolved runtime path, and availability.
- `youtube`: exact validated HTTPS watch URL and 11-character video ID.

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

New collections accept only local catalog references. Existing v3 mixed collections are tagged as legacy and preserved byte-for-byte at the item level; their UI is read-only with play, enqueue, and export. Spotify playlists remain live provider contexts, radio uses pinned stations, and Up Next is the only new cross-provider collection FluidMusic owns.

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

### Expandable Spotify playlists

Queued Spotify playlists remain provider contexts. Their expanded track rows carry the original page position before unsupported entries are filtered; selecting a duplicate song sends a numeric context offset, not the first matching URI. The controller resolves the original queue object again after asynchronous work, so removing or moving a duplicate context does not select another occurrence.

FluidMusic does not copy Spotify playlists into new local collections.

## Titlebar and owned YouTube page

The controller is created at plugin registration and is shared by the Media route, titlebar contribution, and optional mini-player pane. The titlebar contribution replaces the old statusbar and workspace footer player.

`openYouTube()` calls `ctx.preview.openOrFocus({ key: 'fluid-music-youtube', url: 'https://www.youtube.com/', label: 'YouTube' })` and retains only that returned handle. Explicit user actions and polling while YouTube is the selected source call `ctx.preview.executeJavaScriptIn(handle, code)`. Before discovering or mutating media, the injected script requires HTTPS, exact host `www.youtube.com`, exact path `/watch`, and an exact 11-character `v` ID. Results are schema-checked before display or queue insertion. Ended state advances FluidMusic Up Next through a transition-bound exactly-once guard. Previous and Next traverse FluidMusic Up Next rather than invoking provider navigation. Opening grants no execution consent; popped-out, navigated, missing-page, and consent errors remain visible to the user.

## Search

Spotify API results are normalized into track rows and album/artist/playlist cards.

## Capability matrix

| Capability | Spotify | Radio | Local | YouTube |
| --- | --- | --- | --- | --- |
| Play/pause | Connect command | Internal audio | Internal audio | Owned watch page |
| Previous/next | Connect contexts + app queue tracks | App queue, not station skipping | App queue | App queue |
| Seek | Connect | No | Yes | Selected watch item |
| Volume | Connect | Internal | Internal | Selected watch item |


## Theme and accessibility

FluidMusic chrome derives from Hermes `--ui-*` variables and `color-mix(...)`. The Night Radio palette uses semantic dark navy/graphite surfaces, off-white type, coral live state, and restrained violet provider identity while remaining legible in light host themes. App icons use SVG paths, essential actions are keyboard reachable, focus rings use the active accent, and container queries cover desktop through 390 px.

## Security boundaries

- OAuth and provider tokens remain in Hermes credential stores.
- SQLite contains no credentials, cookies, object URLs, or audio bytes.
- Radio inputs accept only public credential-free HTTPS streams and are not backend-proxied.
- Local scanning is rooted in explicit user approvals and renderer Node integration remains disabled.
