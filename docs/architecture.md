# FluidMusic architecture

## Design goal

FluidMusic presents one music workflow while keeping four playback engines honest:

```text
FluidMusic coordinator
├── Spotify adapter ──> Spotify Web/Connect APIs ──> selected Spotify device
├── radio adapter ──> Radio Browser metadata ──> internal HTMLAudioElement
├── local adapter ──> SQLite catalog ──> Hermes seekable media protocol
└── YouTube adapter ──> capability-protected loopback embed host ──> official iframe relay
                      (optional first-party watch fallback only with a verified host owned-view capability)
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

FluidMusic owns the Spotify integration: `dashboard/providers/spotify.py` implements official OAuth Authorization Code + PKCE with validated state/redirect/account binding and single-flight refresh, and `dashboard/providers/token_store.py` keeps tokens in a protected profile-local store separate from the public SQLite library. It imports no Hermes-core or sibling-plugin Spotify implementation, and OAuth tokens never reach the renderer, logs, or exports. The backend provides:

- PKCE status/start routes;
- `/me/player/devices` discovery and active-device fallback;
- playback, seek, volume, transfer, queue, shuffle, and repeat routes;
- paginated search;
- current-user playlists via `/playlists`;
- playlist items via `/playlists/{id}/tracks` with occurrence identity.

Spotify audio always remains on a Spotify Connect device.

### Queue ownership and progress

An individual Spotify track starts with its retained album/playlist context and selected-track offset when catalog metadata supplies that context; otherwise it uses the documented `uris` payload. The controller separately records an expected track guard. When local projection reaches the duration, Spotify reports the track ended, or Spotify reports a different URI after confirming the expected one, the controller advances the FluidMusic queue exactly once.

The **Let Spotify continue after a track** setting disables that guard. Spotify may then continue inside its context or recommendations without changing the selected FluidMusic queue item.

Authoritative Spotify snapshots are bounded to no more often than every 8 seconds while the workspace is open and 20 seconds while closed. Between snapshots, a 500 ms local clock projects elapsed position from the last position, duration, playback state, and receipt time. The local clock makes no network calls; later snapshots correct any drift.

### Expandable Spotify playlists

Queued Spotify playlists remain provider contexts. Their expanded track rows carry the original page position before unsupported entries are filtered; selecting a duplicate song sends a numeric context offset, not the first matching URI. The controller resolves the original queue object again after asynchronous work, so removing or moving a duplicate context does not select another occurrence.

FluidMusic does not copy Spotify playlists into new local collections.

## Titlebar and YouTube player

The controller is created at plugin registration and is shared by the Media route, titlebar contribution (when the host exposes `TITLEBAR_AREAS.right`), and optional mini-player pane. The titlebar contribution replaces the old statusbar and workspace footer player.

YouTube search (`/youtube/search`) and watch-URL resolution (`/youtube/resolve`) return real titles and safe metadata. Playback runs inside the FluidMusic player through the backend's 127.0.0.1-only capability-token embed host (`/youtube/embed-host`) with Host/path checks, exact video-ID validation, origin/Referer preservation, and an official postMessage command/state relay. Stale or foreign player messages are ignored; commands and completions are generation-bound so a late report from a previous item can never settle or advance the current one.

For content that refuses embedding but works on the authorized normal watch page, a first-party watch fallback is offered only when `youTubeWatchCapability` verifies the public SDK's owned-view door (`OwnedMediaView` + `host.mediaSession`); otherwise the exact missing contract is reported with Retry/Skip. The fallback keeps exactly one active engine and one queue/current-item/history event, retaining position/volume where supported. There is no second YouTube pane, no focused-chat Browser borrowing, and no private host patch. Ended state advances FluidMusic Up Next through a transition-bound exactly-once guard; Previous/Next traverse the FluidMusic queue, never provider navigation.

## Listening sessions, resume, recovery and data safety (0.5.0)

Queue editing (Play next, multi-select remove/move, confirmed clears, one-step undo) carries display-only provenance; listening sessions persist safe source references under a separate storage key with Replace/Append restore review. Eligible long-form YouTube/local items store resume positions and timestamp bookmarks in profile-local SQLite (`resume_positions`, `bookmarks`); history supports title/source/date filters, pagination, per-entry removal and an explicit retention preference. A single monotonic sleep-timer owner pauses only the bound current engine and cancels on source change. The Recovery center projects evidence-based source health with bounded retries/cooldowns. SQLite schema changes are versioned (`PRAGMA user_version`) with bounded pre-migration backups and rollback; raw legacy collections are preserved byte-for-byte. Host doors and fallbacks are declared in `docs/handoffs/agent-plan/COMPATIBILITY.md`.

## Search

Spotify API results are normalized into track rows and album/artist/playlist cards.

## Capability matrix

| Capability | Spotify | Radio | Local | YouTube |
| --- | --- | --- | --- | --- |
| Play/pause | Connect command | Internal audio | Internal audio | Embed relay / capability-gated watch |
| Previous/next | Connect contexts + app queue tracks | App queue, not station skipping | App queue | App queue |
| Seek | Connect | No | Yes | Selected item via relay |
| Volume | Connect | Internal | Internal | Selected item via relay |


## Desktop-only operation and playback continuity (FM-29 assessment)

Owner question: "can everything run inside the DESKTOP plugin?" Honest answer: NOT entirely, and it should not. The desktop renderer already owns every part of playback continuity — one controller, one queue/index, one active engine, the audio element and the integrated YouTube frame, generation-bound commands, and storage-backed state. Those survive provider/auth latency because they never await a network round-trip mid-transition.

What genuinely needs the backend (the Hermes plugin API served through the gateway): the OAuth PKCE callback listener on `127.0.0.1:43827` (it cannot live in a renderer that has no inbound socket), protected token storage, yt-dlp search/resolve/audio download, profile-local SQLite history/library, and Radio Browser lookup. Moving those into the renderer would mean exposing a listener from untrusted UI code and duplicating persistence — worse security and design, not better. So full desktop-only operation is declined on those grounds; the owner's actual pain (music cutting out during auth/URL fetches) is addressed directly instead:

- Auth/URL/settings fetches (`/spotify/auth/*`, `/youtube/search`, `/youtube/resolve`, `/youtube/embed-host`, `/settings`) are side-requests: they issue no play/pause/stop/transfer command, do not change status/queue/index/engine, and never remount the current frame. Fixtures assert this while state is `playing`.
- A background audio fallback reports progress through `message` only — it is never a transport transition and never rewrites the shared status.
- Provider polls are generation-bound and only reflect state for the current source; a late OAuth/URL response cannot retarget the engine.
- Residual boundary: the host browser/Desktop may itself duck or defocus audio when an OAuth window opens, and a gateway/plugin reload can unmount the surface. Those are host behaviors, not FluidMusic command paths; cloud fixtures cannot prove them and they remain owner review.

## Theme and accessibility

FluidMusic chrome derives exclusively from Hermes `--ui-*` semantic variables and `color-mix(...)` — there is no private palette (the historical private-palette description is superseded). Surfaces, text roles, hairlines, hover/selected, focus and live state all follow the active host theme, including tinted themes; state is never conveyed by color alone. App icons use one semantic SVG stroke vocabulary, essential actions are keyboard reachable, icon-only controls are named, focus rings use the active accent, reduced motion is honored, and container queries cover desktop through 320–390 px.

## Security boundaries

- Spotify OAuth tokens remain in the FluidMusic-owned protected profile-local token store, never in the renderer, public SQLite, logs or exports.
- SQLite contains no credentials, cookies, object URLs, or audio bytes; resume/bookmark rows store safe source references only.
- Radio inputs accept only public credential-free HTTPS streams and are not backend-proxied.
- Local scanning is rooted in explicit user approvals and renderer Node integration remains disabled.
