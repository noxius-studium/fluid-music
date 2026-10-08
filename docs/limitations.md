# FluidMusic limitations and provider boundaries

FluidMusic unifies discovery, playlists, and queue order. It does not unify provider rights, subscriptions, media pipelines, or transport semantics.

## Spotify Connect boundary

FluidMusic is a Spotify Connect remote. It does not receive or decode Spotify audio.

Consequences:

- playback requires an available Spotify Connect device;
- an authenticated account can legitimately report zero devices;
- transfer, track availability, seek, volume, shuffle, repeat, and queue commands can be rejected by Spotify or the target device;
- account plan and regional availability remain Spotify decisions.

Spotify credentials remain under Hermes' PKCE/token management and never enter the renderer or local-library database.

FluidMusic follows its own queue after an individual Spotify track by default. This handoff is not gapless because the remote Spotify device must stop before the next engine starts. When **Let Spotify continue after a track** is enabled, Spotify owns continuation and may choose a context track or recommendation; FluidMusic cannot predict that selection in advance.

Elapsed time between Spotify snapshots is a local projection. It is corrected on the next authoritative snapshot, after seeking, and after transport changes. Brief drift remains possible when the Spotify device buffers or is controlled from another client.

## Radio boundary

Radio Browser is a directory, not an uptime or playback guarantee. A station can disappear, redirect, change codecs, require unsupported headers, reject a browser client, or block analysis through CORS.

A station may play while its audio analyser is unavailable. FluidMusic keeps playback controls and shows a static visual state rather than fabricating waveform samples. Previous/Next traverse the FluidMusic queue, not the contents of a live station. Radio has no seek, shuffle, or repeat controls.

## Persistent local-library boundary

FluidMusic indexes only user-approved absolute directories. The SQLite catalog stores paths and metadata but not audio bytes. The renderer still has no unrestricted Node or filesystem access.

Current constraints:

- supported extensions are MP3, FLAC, M4A, AAC, WAV, Ogg, Opus, and WebM;
- embedded tags and album artwork are not yet parsed, so display titles default to filename stems and artwork uses the FluidMusic fallback;
- each scan has a 50,000-track safety limit;
- directory symlinks are not followed;
- unreadable files remain unavailable;
- move recovery uses a bounded content fingerprint and relinks only unambiguous matches;
- on a remote Hermes gateway, a path chosen on the desktop may not exist on the backend host, so the backend-host absolute path must be entered explicitly.

Removing a scan root removes that root's catalog rows. Existing playlist references remain but become unavailable until a matching stable track is cataloged again.

### Visualization without host changes

Indexed files retain ordinary persistent playback, but are not connected to Web Audio. Open a file using **Local music → Open audio files** for visualization; these browser-granted files are session-only and cannot become persistent playlist references. Reopen them after restarting, or index their folder for durable playback without visualization.

## Mixed playlists and queue

A FluidMusic playlist can persist local and Spotify tracks together, plus radio references. That does not make controls uniform:

- Spotify commands act on a remote device;
- radio and local audio play in Hermes;
- transition latency varies by provider;
- gapless playback is not promised;
- a missing local file or unavailable provider item remains represented rather than silently substituted.

Queued Spotify playlists can be expanded to select an individual song at its original position. Spotify still owns continuation inside that context. Available playlist content depends on Spotify API permissions and account restrictions; a rejected request produces a retryable error, not extracted or invented tracks. Copying a Spotify playlist into FluidMusic is a snapshot of its supported songs, not a live sync. Copies are bounded to 10,000 entries and preserve duplicates. A same-size edit made remotely during pagination cannot always be detected.

## Non-goals

FluidMusic is not:

- an ad blocker, subscription bypass, Premium unlocker, DRM workaround, or downloader;
- a Spotify audio client or re-streaming proxy;
- a guarantee of radio-stream licensing, uptime, or global availability;
- a cross-provider gapless audio mixer.

## Issue reports

Include the provider, exact action, visible error, and whether the same item works in the provider's official client. Never include access tokens, refresh tokens, client secrets, cookies, authorization headers, or private local paths unless the path itself is the issue and has been sanitized.
