# FluidMusic 0.4.1

## Changed

- Spotify playlist contexts in the queue expand into paginated song rows. Select an exact song, including a later duplicate occurrence, without replacing the context or rebuilding the mixed queue.
- Save-to-playlist is explicitly centered despite the host CSS reset and uses an opaque elevated theme surface, visible destination selection, and an explicit Save action.
- Spotify collection saves offer editable individual-song copies (default) or one clearly labeled Spotify reference. Complete pagination, order and duplicates are preserved; errors/cancel do not create partial copies or empty destinations. Existing and new destinations are supported, and success includes a saved count.
- Analyser visibility uses a side branch rather than disconnecting/reconnecting the audible gain path. Volume transitions are smoothed. Indexed playback does not attempt unsupported analysis first.
- Spectrum bars use actual sample rate and logarithmic frequency bands, with a subdued full-width baseline rather than invented audio activity.

## Boundaries

No Hermes host transport or security changes are included. Indexed playback stays persistent and unvisualized. Browser-opened files can visualize but remain session-only; Spotify Connect has no local samples. No YouTube adapter is included. Provider handoff and network streams are not promised to be gapless.

## Verification

Generated-runtime Node regressions cover duplicate context/song selection, moved/removed rows, complete collection copies, restart, failed pages, cancellation, deleted destinations, storage refusal, missing/ephemeral files, analysis topology and spectrum bands. Playwright runs the actual generated plugin with synthetic Spotify API fixtures, real DOM interactions and real Chromium Audio/AudioContext. It covers 51-song pagination, saves/retry/cancel/reload, host-reset/glass-theme modal placement, narrow layouts, nonzero analyser samples, stable media-element identity, advancing playback without pause/seek/reload events during visual/navigation/gain changes, and explicit seek. These are not live Spotify account acceptance or a claim of subjective listening quality.

Applying this release reloads the plugin and can interrupt an active session. Installation/live provider acceptance must wait for an explicitly agreed playback break; no desktop restart is required by the renderer-only changes.
