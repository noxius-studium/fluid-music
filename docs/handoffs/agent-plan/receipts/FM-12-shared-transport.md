# FM-12 receipt — One shared bottom transport and usable volume everywhere

Task: FM-12 (t_279dcbda) · Board: fluid-music · Card: `kanban/FM-12.md`
Requirements: F09, F10, F11, F12, F24 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: c10c49b36cb0a958e47afa24158686aef1d7f3ce (remote read-back equal; tree clean).

## 1. What was unified

Capability table (the single source of control truth):
- `mediaCapabilities` now includes YouTube: play/previous/next/seek/volume true (queue-level prev/next; bridge seek/volume), shuffle/repeat/device false. Radio unchanged: play/volume only — **no fake seek, no fake prev/next**. Local/spotify/unsupported rows unchanged. The main bottom anchor (NowPlayingBand) and mini player are capability-driven, so YouTube now gets the SAME Transport + SeekBar-or-status + VolumeControl as every other provider — previously it rendered none of them.

Real adapter actions (no notice-only stub, no provider copies):
- Controller gains a registered command sink (`setYouTubeCommandSink`): the ACTIVE YouTube surface registers its real channel; shared `toggle`/`seekTo`/`setVolume` drive it.
  - toggle: playVideo/pauseVideo from truthful `youtube.playing` state; state changes arrive via bridge reports (no optimistic fake status).
  - seekTo: `seekTo [seconds]` + progress update only when actually sent.
  - setVolume: global volume atom stays authoritative; `setVolume [percent]` forwarded to the active engine (embed syncs on ready).
  - No sink / not ready ⇒ honest "The YouTube player is not ready yet…" message; nothing invented.
- YouTubeTransport registers its origin-bound, readiness-gated `send` as the sink (cleanup unregisters); its bar is the shared MiniControlBar with `controller.toggle`. The retired notice-only toggle stub and the selection notice copy are gone.
- OwnedWatchSurface registers a bounded sink adapter over the public owned-view contract (play/pause/setVolume; unsupported funcs return false → honest message). Watch mini bar uses shared toggle/volume.
- MiniControlBar now renders the SAME `VolumeControl` (mute + range + %) as the main anchor; the separate `fluid-mini-volume` range implementation and the `onVolumeChange` double-send path are REMOVED (bundle-verified absent).

Usable volume widths (scoped CSS):
- Compact VolumeControl: 118px→**150px** with fluid range (was fixed 60px).
- Mini control grid volume column: minmax(90px)→**minmax(150px,1fr)**; mini volume min-width 55px→150px; ranges fluid (were fixed 90px).
- Narrow mini (≤360px container): volume becomes a **full row** (grid areas "controls links" / "volume volume", width 100%); ≤280px keeps the full-row layout (only the % label hides). Main anchor ≤460px already full-width. Titlebar popover uses the full 170px VolumeControl.

## 2. Tests (headless labelled doubles)

- `tests/shared-transport.test.mjs` (NEW, 5): full capability table incl. YouTube + radio-no-fake-seek + null-item; sink-driven toggle/play-pause/seek(seconds)/volume(percent) with ZERO provider REST and zero internal audio engines; honest not-ready without a sink (no fake playing state) + unregister; queue prev/next as real occurrence actions; bundle/CSS static proof (MiniControlBar uses VolumeControl, no onVolumeChange anywhere, retired stub gone, 150px fluid + full-row narrow rules present, old 60px range absent).
- Intentional baseline updates (requirements preserved): the FM-03-era "YouTube capabilities all-false" assertion now encodes the FM-12 shared contract (URL/metadata safety assertions unchanged); the notice-copy assertion now asserts the honest not-ready state (still proves no REST/preview/internal-audio for embed).
- All prior handoff/bridge/focus/watch-fallback suites pass unchanged — sink registration adds no timers and no observation polling.

## 3. Checks and ACTUAL results

1. `node --test tests/*.test.mjs` → **121 tests, 118 pass, 3 fail** — the 3 are exactly the pre-existing stale string assertions (navigation destinations, workspace shipped-surface list, discovery copy) deferred to FM-13/18/24.
2. `.venv/bin/pytest tests/ -q` → **119 passed, 0 failed** (no backend change this card).
3. `build_desktop.py` + `--check` exit 0; bundle ESM syntax OK.
4. No Python changes; ruff baseline untouched.

## 4. Honest boundaries

- Headless fixtures prove command routing, capability gating, state truthfulness and CSS geometry rules — NOT real embed audio, Widevine, or rendered pixels. Real YouTube playback/volume/seek feel and narrow-layout rendering on the owner's Desktop remain explicitly UNVERIFIED (FM-25).
- Watch-contract seek is unsupported by the public owned-view API; attempts return false and surface the honest not-ready message (no fake seek).
- Busy semantics preserved: embed bar disabled until ready; runTransition serializes shared commands; polling/focus continuity protections unchanged.

## 5. Protected work (untouched)

.env/auth/credential stores, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 118 node passes + 119 pytest requirements, provider adapter semantics (FM-04 bridge whitelist/origin binding intact), FM-13 navigation, FM-18 Settings states.

## 6. Downstream

FM-13 (next): navigation destinations (retires 1 stale assertion). FM-18: Settings states + discovery copy (retires 2 stale assertions). FM-23: adapter formalization. FM-25: owner live transport/volume review.
