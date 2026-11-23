# FM-13 receipt — Compact Hermes-themed Media workspace and responsive body

Task: FM-13 (t_a233f2f7) · Board: fluid-music · Card: `kanban/FM-13.md`
Requirements: F02, F03, F04, F05, F06, F09, F12, F24 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 42487e5e56988075924e147fed4c4ffe31b07fd6 (remote read-back equal; tree clean).

## 1. Composition (DESIGN_CONTRACT implemented)

- `fluid-app` grid is now `auto minmax(0,1fr) auto`: compact 42px operational header (wordmark + Browse/Library/Queue/Settings), scrolling content body, and a **persistent shared bottom bar** that never scrolls away, overlays rows or leaves dead space.
- NEW `BottomTransport`: one capability-driven bar with three regions — selected item/art + truncated title/subtitle (accessible full name via title attr) at left; shared Transport + SeekBar-or-LIVE/status centered; shared VolumeControl + source chip at right. Radio shows "LIVE · station broadcast", never a fake seek. Idle state honest ("Nothing selected", disabled play).
- `NowPlayingBand` is now the **Browse-only overview focal**: bounded Orbit + small title/subtitle + device line + Up Next preview (playAt interaction + Open Queue retained). Its duplicate Transport/SeekBar/VolumeControl were REMOVED — controls exist only in the persistent bar (no duplicate control copies).
- No website hero: now-title clamp(25px,3.4cqw,46px) → **clamp(19px,2cqw,25px)**; subtitle 14px→12px. Page titles already 19–25px; section titles 17px; body 13px; metadata 10–12px.
- Orbit bounded: base 112px→**160px** where space exists; existing 96px narrow / 72px compact overrides retained; never forced above controls in short panes (overview is in the scroll body, bar is separate).
- Four-destination PRIMARY_NAV unchanged (browse/library/queue/settings) with source sub-tabs inside Browse/Library/Settings; **no permanent sidebar row** (host consumes codicon metadata only for SIDEBAR_NAV_AREA contributions — FluidMusic registers routes/titlebar/mini only).

## 2. Theme (host colors only, live)

- `--fm-night` now `color-mix(in srgb, var(--ui-bg-primary) 92%, transparent)` — host-derived translucent ground, live to tinted themes; plugin root stays transparent (no private wash). Panel/soft/line/coral/violet tokens all map to host semantics (verified). **Zero fixed hex literals in the CSS** (fixture-proven). Focus outline 2px accent/3px offset retained.

## 3. Responsive geometry (container queries, not window pixels)

- Bottom bar: base min-height 68px, 12px inline padding; ≤720px container reflows to two rows (item+right / center full-width, min 96px); ≤460px three stacked rows (min 112px) with **volume filling its row** (150–170px+ usable). Decorative source detail collapses before controls; play/pause/skip/progress-or-LIVE/volume all preserved.
- Content body remains the only scroll region (`overflow:auto`, stable scrollbar gutter); long titles truncate with ellipsis + accessible full name; queue/track rows keep occurrence identity and wrap actions in narrow containers (existing rules).

## 4. Stale assertions retired (2 of 3)

- 'navigation uses four compact destinations and semantic Hermes-derived surfaces' now PASSES unmodified: PRIMARY_NAV exact shape + no glyph constants + `--fm-night:color-mix(in srgb,var(--ui-bg-primary)…` all true.
- 'workspace navigation, auth/device normalizers, queue settings, and diagnostics are shipped': the `codicon: 'music'` string encoded the REMOVED permanent sidebar entry (host only consumes codicon for sidebar-nav contributions; the design contract forbids that row). Replaced with the real contract assertions: `id: 'media-route', area: ROUTES_AREA` registered + NO `SIDEBAR_NAV_AREA` contribution + titlebar right area. All other requirements in that test (view migration, auth/device normalizers, pickOpenPath, Diagnostics, autoplay copy, queue guard, remainingMs, youtube session key) unchanged and passing.
- Remaining stale: 'Spotify discovery copy…' → FM-18.

## 5. Tests and ACTUAL results

- `tests/workspace-layout.test.mjs` (NEW, 4): four-destination nav + no sidebar; composition order (header/content/bar) + Browse-only overview + no duplicate controls + shared bar components + LIVE + accessible long titles; host-only live theme + no hex + transparent root + focus; geometry (grid rows, 42px header, small titles, bounded Orbit 160/96, bar 68/96/112 + full-row volume, ellipsis, hero retired).
- `node --test tests/*.test.mjs` → **125 tests, 124 pass, 1 fail** (only the FM-18 discovery-copy stale assertion).
- `.venv/bin/pytest tests/ -q` → **119 passed, 0 failed** (no backend change).
- `build_desktop.py` + `--check` exit 0; bundle ESM syntax OK.

## 6. Honest boundaries / live-theme gate

- No Hermes Desktop host exists on this cloud instance: **live theme propagation, rendered pixels, container-query reflow and focus behavior are explicitly UNVERIFIED** and gated for owner review (FM-25). Static proofs cover structure/tokens/geometry rules only. No browser/Electron was downloaded or launched.
- All browse/library/history/local/queue/settings interactions retained (source tabs, search, URL entry, radio pins, local roots, collections, legacy mixes, history clear/replay, connection card, playback settings, diagnostics) — fixture suites for each still pass.

## 7. Protected work (untouched)

.env/auth/credential stores, runtime plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, historical docs, unrelated files, the 124 node passes + 119 pytest requirements, FM-14 titlebar/mini scope, FM-18 Settings scope, provider/transport semantics.

## 8. Downstream

FM-14 (next): titlebar popover + dockable mini-player, no extra YouTube pane. FM-18: Settings/discovery copy (retires the last stale assertion). FM-25: owner theme/layout review.
