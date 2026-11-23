# FM-14 receipt — Titlebar popover and dockable mini-player, no extra YouTube pane

Task: FM-14 (t_1bade57c) · Board: fluid-music · Card: `kanban/FM-14.md`
Requirements: F02, F07, F08, F09, F11, F12, F17, F24 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: fc4d7b6249c9ea4ebf50d7129839e36ab2ec20e3 (remote read-back equal; tree clean).
Resume note: prior run #17 claim died with the container restart (PID absent, no START, no edits); released via supported `hermes kanban reclaim`, re-claimed as run #18, fresh CALLBACK START posted and read back before edits. No completed work replayed.

## 1. Titlebar trigger and popover (F07, F17, F24)

- Quiet trigger retained: real selected title (Spotify live title when present), actual status dot (`data-state`, now `aria-hidden` decorative), explicit play/pause Action beside it. Added `title` attr so a truncated long title keeps an accessible full name; `aria-controls="fluid-title-popover"` wired while open (dialog now carries that id); `aria-expanded`/`aria-haspopup` retained. Source label stays hidden before transport (existing CSS).
- Popover geometry already matched the contract and is now fixture-pinned: width `min(390px, calc(100vw - 24px))`, max-height `min(680px, calc(100vh - 72px))`, elevated host surface, own scroll.
- Popover content: compact summary, shared `Transport`, `SeekBar`-or-LIVE, full usable `VolumeControl` (170px, not a tiny range), Spotify device line, Notice, Open Media / Open Queue / YouTube-in-Media shortcuts. **Up Next rows are now real buttons** (`playAt(at + offset + 1)` through the shared coordinator, occurrence-safe keys, `aria-label="Play …"`, full-name title attr) instead of inert divs — keyboard-reachable like the Browse preview.
- Esc and outside-pointerdown dismissal restore trigger focus; open moves focus to the first enabled control (existing behavior, now fixture-pinned). No Browser/preview shortcut anywhere in the popover/titlebar path (fixture-asserted).

## 2. Dockable mini-player (F08, F09, F11, F12)

- ONE pane registration for every source (`mini-player`, area `panes`), width **300px → 320px** (audio-only target), height 420px (keeps YouTube ≥ ~360px target). No second YouTube pane, no visualizer, no giant track header. The only other `panes` registration remains the gated SDK-incompatible fallback.
- Audio-only: compact summary/art + seek-or-status above the SAME anchored `MiniControlBar` (shared previous/play/next + shared compact `VolumeControl` + Queue/Media links). New container **height** queries (`container:mini / size`): ≤240px shrinks art to 40px (within the 40–64px band), single-line title, hides subtitle, tightens margins; ≤170px drops decorative art entirely. Body scrolls (`overflow:auto`) instead of silently clipping; the controls row is never clipped. Narrow-width reflow (≤360px volume full row, ≤280px value hidden) retained.
- YouTube in the same pane: video region now has a **declared 200x200 minimum** (`min-width/min-height:200px` on frame and wrap; grid row `minmax(200px,1fr)`), so a short pane can never squeeze the video below provider constraints. Below ~360px pane height an honest `role="status"` expand note appears ("Expand the FluidMusic player to about 360px or more; playback controls stay available below") and the player scrolls rather than clipping controls — the unavoidable physical minimum is declared, not pretended away. Embed/owned-watch engines, switching/error/retry/fallback UI unchanged.

## 3. Controller lifetime (F17)

- No controller change needed: popover open/close is a pure atom; polling is registration-level and survives popover close AND Media-route unmount (closed cadence), remount restores open cadence, disposal stays inert. New headless fixture proves: open/close creates/clears zero timers, no media command, no Browser navigation, exact occurrence/index/status preserved, observation timers fire without side effects, post-disposal popover/polling calls resurrect nothing.

## 4. Changed files

- `desktop/src/44-workspace.js` — popover id + playable Up Next buttons; trigger title/aria-controls/aria-hidden dot; mini pane 320px + comment.
- `desktop/src/43-visualizer.js` — honest short-pane expand note in the YouTube mini layout.
- `desktop/src/20-styles.js` — mini size container, video 200px minimums + scroll-not-clamp rows, expand-note visibility query, audio short-height art/subtitle adaptation, body overflow.
- `desktop/plugin.js` — regenerated via `scripts/build_desktop.py` (byte-joined fragments; `--check` clean).
- `tests/titlebar-mini.test.mjs` — NEW: 4 static contract fixtures + 1 headless controller-region lifetime fixture (labelled doubles).
- This receipt.

## 5. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **130 tests, 129 pass, 1 fail** — the single failure is the pre-existing FM-18 stale Spotify-discovery-copy assertion (unchanged baseline; FM-18 scope). All 5 new FM-14 fixtures pass; all FM-00..FM-13 suites pass unmodified.
- `.venv/bin/python -m pytest -q` → **119 passed** (no backend change).
- `python3 scripts/build_desktop.py` + `--check` → exit 0; `node --input-type=module --check` on the bundle → ESM syntax OK.
- No node_modules/browser/Electron downloads; `tests/ui` Playwright harness not run (deps absent, and its expectations predate the FM-08 contract) — left for FM-19/FM-24 reconciliation.

## 6. Honest boundaries (fixture vs live)

- Static bundle/CSS proofs + headless controller doubles only. **Unverified live:** rendered pixels/reflow on the owner's packaged Desktop, real focus restoration timing, real pane docking/resizing behavior, container-query support in the packaged renderer, actual YouTube video minimum enforcement by the provider, real audio/volume. All gated to FM-25 owner review.
- The expand note and 200px minimum are declared geometry, not a claim that the host pane can be resized programmatically — pane size remains host/owner-controlled.

## 7. Commit / push

- Commit SHA + parent + verified remote SHA: recorded in the board CALLBACK FINISH for t_1bade57c (this receipt is part of that same commit). Author Zero2 <deadtrix21@users.noreply.github.com>; push target docs/cloud-kanban-handoff only.
- Remaining dirty work after commit: none. Carried: FM-18 Settings/discovery copy (last stale node assertion), FM-19 keyboard/disposal audit, FM-23 adapter, FM-24 artifact + stale docs (incl. tests/ui), FM-25 owner review.
- Next card: FM-15 (t_28d93939) — radio discovery, pins and source-honest LIVE behavior. Continuing serially.
