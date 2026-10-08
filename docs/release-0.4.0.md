# FluidMusic 0.4.0 — listening workspace overhaul

## Interface

Every workspace page now uses the new navigation, hierarchy, track rows, dialogs, controls, and pane-width responsive layout. The old three-column page, cramped inline playlist selectors, and fixed-to-the-window mobile player are gone. The dock stays inside its owning Media pane.

Playlist management includes:

- Create and edit names/descriptions in focus-managed dialogs.
- Add multiple tracks from the current queue, local catalog, pinned/curated radio, or Spotify search.
- Create a playlist directly from a track's Save action, including when no playlists exist.
- Search playlists and filter their tracks without losing original occurrence indices.
- Reorder duplicate occurrences, play from a specific row, or append a collection without replacing playback.
- Bulk removal and explicit deduplication, with one-level Undo for destructive changes. A later unrelated edit invalidates Undo rather than discarding newer work.
- Duplicate playlists; confirm deletion; save the current queue as a persistent playlist.
- Export one/all playlists as JSON. Import validates the complete file before an additive write with new playlist IDs. Local references contain no raw paths or audio bytes.
- Correctly display local availability from the hydrated catalog instead of stale serialized metadata.

Spotify library and playlist detail pages now expose pagination instead of silently stopping after 50 entries. Local library and playlist lists use incremental rendering. Diagnostics can be filtered.

## Player, status bar, and movable pane

The status bar exposes playback, Next, volume percentage/slider, mute/restore, visualizer visibility, and style selection while working outside Media.

The **FluidMusic player** is a native `panes` contribution. Its initial placement is the right pane, but users can move, dock, resize, or close it with Hermes' normal layout controls. It contains artwork, source/state, transport, elapsed/duration time, seeking where supported, volume, and a larger optional visualizer. This is not a separate playback engine: Media, the pane, and the status bar control the same application-scoped controller.

Visualizer styles:

- **Spectrum:** frequency bars.
- **Waveform:** time-domain samples.
- **Mirror:** centered frequency bars.

Each visible canvas holds one demand lease. Hidden or offscreen panes, hidden status visuals, paused playback, reduced motion, document hiding, and unmounting release that lease, cancel requestAnimationFrame, and stop sample reads. With no consumers, the analyser disconnects and the audio source connects directly to the normal gain stage. Audio playback itself continues. Canvas buffers are reused; rendering is capped at 30 fps.

Spotify Connect never supplies decoded audio to FluidMusic and therefore shows an honest remote-source placeholder. Radio and local origins must permit Web Audio analysis; CORS failures fall back to ordinary audio playback without fake visualizations.

## Direct file playback

Live acceptance identified that the installed Hermes media protocol rejects analysis-enabled requests for indexed files. With user approval, **Local music → Open audio files** adds a separate browser-granted File path. It creates streaming object URLs rather than reading whole audio files into memory, exposes real Web Audio samples, and never changes the persistent catalog. A session may hold up to 500 opened files.

These entries are explicitly marked session-only, excluded from persisted queues and playlist saves, and revoked on disposal. Restarting Hermes requires selecting them again. This prevents temporary object URLs from becoming broken saved playlist references. Ordinary indexed-library playback remains unchanged.

## Playback corrections

- Clear queue pauses Spotify before clearing state and invalidates pending playback work.
- Playlist playback shares the transition chain; stale playlist requests cannot resurrect cleared playback.
- Empty/unavailable playlist selections preserve the existing queue.
- Removing a non-current row no longer invalidates active radio event handlers.
- Removing a paused current row does not unexpectedly start its successor.
- Resume does not resend a Spotify track/context selection and restart it.
- Spotify album/playlist contexts route Next to Spotify instead of jumping out into the mixed queue.
- Analysed radio applies volume once, not to both the audio element and gain node.
- Volume slider requests to Spotify are coalesced; seeking commits at the end of a gesture rather than on every intermediate input event.
- Local hydration is latest-response-wins and retains valid session-local references.

## YouTube feasibility — not implemented

Keeping advertisements is necessary but is not sufficient to make hidden playback compliant. YouTube's Developer Policies explicitly prohibit background players not displayed in the page, tab, or screen the user is viewing (III.I.9), removing or blocking ads (III.I.5), and separating audio from video (III.I.7–8).

The defensible direction is an **official, visible video player in a persistent docked pane alongside the user's work**. Shared FluidMusic controls could forward documented IFrame Player API commands while leaving the official player, branding, ads, and links visible and unobstructed. A renderer-owned iframe must remain mounted across Media-to-chat navigation; cookie/partition persistence alone does not preserve the engine.

This remains a separate integration, requiring real Electron origin/referrer/embed verification, host-pane lifecycle tests, minimum player sizing, and behavior that pauses when the video surface is hidden. It does not satisfy invisible/minimized audio-only playback, and no such behavior is claimed or shipped.

Sources checked during implementation:

- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/iframe_api_reference
- https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

## Verification boundaries

`npm run test:ui` loads the generated plugin in real Chromium/React with an explicitly simulated SDK and provider catalog. The test generates a WAV and exercises real Audio/AudioContext processing, navigation persistence, visible demand, hide/unhide, styles, reduced motion, and teardown. Provider responses are fixtures, not claims of live Spotify playback. Screenshots cover wide/narrow panes and light/dark themes. Axe checks target the FluidMusic workspace.

The unit suite evaluates the actual shipped pure-model and controller source regions. Python tests exercise the backend/router and deterministic source/package contract. Live Hermes installation and provider acceptance must be recorded separately; isolated browser success alone is not evidence of live Connect playback or a particular station's availability.
