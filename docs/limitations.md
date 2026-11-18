# FluidMusic limitations and provider boundaries

FluidMusic unifies discovery and temporary queue order. It does not unify provider rights, subscriptions, media pipelines, persistent collection ownership, or transport semantics.

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

Radio renders only play/pause and volume. It does not expose previous, next, seek, shuffle, repeat, or provider-device controls.

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

### Session files

Browser-granted files are session-only and cannot become persistent collection references. Reopen them after restarting, or index their folder for durable playback. FluidMusic has no visualizer or analyser settings.

## Collections and queue

New FluidMusic collections are local-only. Existing v3 mixed playlists are preserved as read-only Legacy mixes and are not silently deleted, rewritten, or migrated. Spotify playlists remain provider-owned and radio persistence is pinned stations. The cross-provider Up Next queue is temporary/restart-restorable.

- Spotify commands act on a remote device;
- radio and local audio play in Hermes;
- transition latency varies by provider;
- gapless playback is not promised;
- a missing local file or unavailable provider item remains represented rather than silently substituted.

Queued Spotify playlists can be expanded to select an individual song at its original position. Spotify still owns continuation inside that context. Available playlist content depends on Spotify API permissions and account restrictions; a rejected request produces a retryable error, not extracted or invented tracks.

## YouTube host dependency

YouTube requires the patched Hermes Desktop preview contract and explicit script consent for the FluidMusic-owned tab. Opening the tab alone does not grant consent. Control is rejected before media lookup unless the page is an exact HTTPS `www.youtube.com/watch` URL with an 11-character video ID. Popped-out previews reject control and page navigation can invalidate state. While a YouTube item is selected, FluidMusic polls the owned page even when compact UI surfaces are closed so one observed completion can advance Up Next. FluidMusic Next always means the next Up Next item; it does not invoke YouTube provider navigation. FluidMusic does not scrape recommendations, claim access to signed-in suggestions, or target the focused chat preview. Isolated fixture tests verify handle targeting and error handling, not live host behavior.

## Non-goals

FluidMusic is not:

- an ad blocker, subscription bypass, Premium unlocker, DRM workaround, or downloader;
- a Spotify audio client or re-streaming proxy;
- a guarantee of radio-stream licensing, uptime, or global availability;
- a cross-provider gapless audio mixer.

## Issue reports

Include the provider, exact action, visible error, and whether the same item works in the provider's official client. Never include access tokens, refresh tokens, client secrets, cookies, authorization headers, or private local paths unless the path itself is the issue and has been sanitized.
