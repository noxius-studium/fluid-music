# FluidMusic limitations and provider boundaries

FluidMusic unifies discovery and temporary queue order. It does not unify provider rights, subscriptions, media pipelines, persistent collection ownership, or transport semantics.

## Spotify Connect boundary

FluidMusic is a Spotify Connect remote. It does not receive or decode Spotify audio.

Consequences:

- playback requires an available Spotify Connect device;
- an authenticated account can legitimately report zero devices;
- transfer, track availability, seek, volume, shuffle, repeat, and queue commands can be rejected by Spotify or the target device;
- account plan and regional availability remain Spotify decisions.

Spotify credentials live in FluidMusic's protected profile-local token store. The self-contained OAuth/PKCE provider never exposes tokens to the renderer, logs, exports, or the public local-library database and does not depend on another Spotify plugin.

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

## YouTube playback boundaries

YouTube plays through the backend's 127.0.0.1-only, capability-token embed host with strict Host/origin checks and the official iframe command/state relay. Embedding availability remains the provider's decision: embed-denied, private, deleted, geo/age/rights-restricted videos are not promised playable, and FluidMusic does not bypass DRM, ads, or entitlements. When a video refuses embedding but works on the authorized normal watch page, the first-party watch fallback is offered only if the host exposes the verified owned-view capability (`OwnedMediaView` + `host.mediaSession`); otherwise the exact missing contract is reported with Retry/Skip. The embed viewport respects the provider's documented minimum — the mini-player never squeezes the video below it. Exactly one engine is active; stale/foreign player reports are ignored and completions advance Up Next exactly once. If the backend runs on a remote cloud host, its loopback URL is not directly reachable from the owner's Desktop; cross-host browser/media acceptance is explicitly gated. Headless fixtures verify routing, validation and error handling, not live embedding or host rendering.

## Listening sessions, resume and recovery boundaries (0.5.0)

- Listening sessions store safe source references only; restore skips unavailable items and never autoplays. Sessions are not a writable mixed-provider playlist hierarchy.
- Resume/bookmarks apply only to eligible long-form YouTube/local items (10 minutes or longer). LIVE radio is never seekable; Spotify position remains provider-owned. Saved positions are profile-local and bounded.
- The sleep timer is session-only: it is not restored after reload, cancels when the source changes, and pauses only the bound current engine. Spotify end-of-item uses the local projected-end anchor, not a provider ended event.
- Recovery health reflects the last real evidence, not a live guarantee; retries are bounded (three attempts, then a cooldown). History retention removes only this profile's played-history rows — never media, queues, collections or provider history.
- Host compatibility is declared for the current/next SDK shape (see COMPATIBILITY.md); arbitrary future breaking Hermes releases are not guaranteed.

## Audio-only YouTube fallback (0.6, owner-approved)

- Settings → Playback → **Audio fallback folder** is a profile-local, non-secret path. When a YouTube item reports an eligible embed/watch failure, the player's **Download audio** action downloads AUDIO ONLY with yt-dlp, prefers a native m4a stream (no FFmpeg merge), and writes it to that folder. No video is downloaded, no signed URLs or credentials are logged, and retries/timeout are bounded.
- The folder is registered as a local-library root and rescanned; the resulting track is added Up Next, never autoplayed. The mini player is controls-only by default; revealing or hiding details never unmounts the active engine or interrupts playback.
- If no folder is configured, the fallback says so and does nothing. A failed or rights-private/deleted item is never labelled "available". Packaged-host playback and live provider behavior remain owner review; cloud fixtures use a labelled yt-dlp double.
- ToS (owner decision, 2026-11-21): accepted for personal use — "I don't care if it breaks the YouTube TOS... I am just providing the software... what people do is not my problem." FluidMusic supplies the path only; no DRM, paid-access, ad or entitlement bypass. Respect your local law and the provider's terms.

## Non-goals

FluidMusic is not:

- a video downloader, ad blocker, subscription bypass, Premium unlocker, DRM workaround, or re-streaming proxy (a bounded, owner-configured audio-only fallback is the sole exception, described above);
- a Spotify audio client or re-streaming proxy;
- a guarantee of radio-stream licensing, uptime, or global availability;
- a cross-provider gapless audio mixer.

## Issue reports

Include the provider, exact action, visible error, and whether the same item works in the provider's official client. Never include access tokens, refresh tokens, client secrets, cookies, authorization headers, or private local paths unless the path itself is the issue and has been sanitized.
