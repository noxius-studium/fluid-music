---
version: alpha
name: FluidMusic Night Radio
description: Deep-navy, source-honest listening surfaces for Hermes Desktop.
colors:
  primary: "#ff786c"
  secondary: "#9b8cff"
  night-mix-anchor: "#08111f"
  graphite-mix-anchor: "#182033"
  ink-mix-anchor: "#f4f1e9"
typography:
  display:
    fontFamily: "inherit"
    fontSize: "58px"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "inherit"
    fontSize: "38px"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "-0.055em"
  title:
    fontFamily: "inherit"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  body:
    fontFamily: "inherit"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "inherit"
    fontSize: "10px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "0.1em"
  mono:
    fontFamily: "var(--font-mono, monospace)"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
rounded:
  source: "3px"
  nav: "4px"
  compact: "5px"
  control: "6px"
  artwork: "8px"
  empty: "9px"
  panel: "10px"
  dialog: "12px"
  orbit: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "7px"
  control: "10px"
  md: "12px"
  content: "14px"
  section: "18px"
  panel: "22px"
  dialog: "24px"
  band: "28px"
  page: "38px"
  wide: "48px"
components:
  top-navigation:
    backgroundColor: "{colors.graphite-mix-anchor}"
    textColor: "{colors.ink-mix-anchor}"
    rounded: "{rounded.nav}"
    padding: "0 38px"
    height: "52px"
  source-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-mix-anchor}"
    rounded: "{rounded.source}"
    padding: "3px 7px"
  source-chip-live:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.source}"
    padding: "3px 7px"
  source-chip-provider:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.source}"
    padding: "3px 7px"
  input:
    backgroundColor: "{colors.graphite-mix-anchor}"
    textColor: "{colors.ink-mix-anchor}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.graphite-mix-anchor}"
    textColor: "{colors.ink-mix-anchor}"
    rounded: "{rounded.panel}"
    padding: "22px"
  titlebar-popover:
    backgroundColor: "{colors.night-mix-anchor}"
    textColor: "{colors.ink-mix-anchor}"
    rounded: "{rounded.artwork}"
    padding: "18px"
    width: "390px"
  orbit-artwork:
    backgroundColor: "{colors.graphite-mix-anchor}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.orbit}"
    padding: "16px"
    size: "240px"
---

# Design System: FluidMusic Night Radio

## Overview

**Creative North Star: "Night Radio"**

FluidMusic is a quiet listening instrument embedded in Hermes Desktop: deep navy carries the workspace, cool graphite separates compact chrome, and sparse coral and violet signals make state readable without turning the surface into a branded streaming clone. The system inherits Hermes typography and semantic `--ui-*` variables so it remains native to the host while keeping a recognisable Night Radio hierarchy.

The signature object is Orbit: a large circular artwork or record field in the now-playing band. It supplies one memorable silhouette while the rest of the interface stays operational—compact Blackstage-style navigation, hairline divisions, aligned metadata, honest provider labels, and dense rows. Runtime provider artwork may fill Orbit and media tiles; no raster artwork, texture, or decorative image asset ships with the plugin.

**Key Characteristics:**
- Deep navy and cool graphite structure with off-white text.
- Coral reserved for live/broadcast emphasis and the active navigation underline.
- Violet used for provider/source identity and selected secondary tabs.
- One circular Orbit focal object; other components remain compact and rectilinear.
- Four stable primary destinations: Browse, Library, Queue, and Settings.
- Provider capabilities and ownership stay visible instead of being visually normalised away.
- Theme-aware surfaces derive from Hermes semantic variables; green-tinted backgrounds are forbidden.

## Colors

The palette is a theme-aware Night Radio shell: fixed accents sit on semantic Hermes surfaces mixed toward navy and graphite.

### Primary
- **Broadcast Coral** (`primary`): live radio labels, the wordmark note, active primary-navigation underline, and urgent playback emphasis. It is a state signal, not a general surface fill.

### Secondary
- **Source Violet** (`secondary`): Spotify/YouTube source identity, Orbit fallback glyphs, and selected secondary tabs. Provider identity remains restrained and textual.

### Neutral
- **Night Ground** (`night`): the principal workspace and compact-player background, derived from Hermes primary background.
- **Cool Graphite** (`graphite`): the 52px top bar and Orbit shell, derived from Hermes secondary background.
- **Warm Ink** (`ink`): high-emphasis text, mixed toward off-white rather than pure white.
- **Panel Veil** (`panel`): translucent settings, connection, and utility containers.
- **Soft Interaction Wash** (`soft`): hover, selection, current-row, icon-tile, and notice wash based on the active Hermes accent.
- **Hairline** (`line`): 1px borders and dividers at 14% of semantic text over transparency.
- **Secondary and Tertiary Text**: always use Hermes `--ui-text-secondary` and `--ui-text-tertiary` for supporting and de-emphasised content.

**The No-Green-Background Rule.** Never tint workspace, card, tile, chip, or selected-state backgrounds green. Spotify remains identifiable through copy, icons, and violet source treatment—not a green wash.

**The Signal Rarity Rule.** Coral means live or active; violet means source or secondary selection. Do not use either as broad decorative fill.

**The Semantic Host Rule.** Base surfaces, text, strokes, focus, and control accent come from Hermes `--ui-*` variables. Fixed brand accents supplement the host; they do not replace its theme contract.

## Typography

**Display Font:** inherited Hermes sans-serif stack  
**Body Font:** inherited Hermes sans-serif stack  
**Label/Mono Font:** `var(--font-mono, monospace)` for clocks, percentages, and diagnostics

**Character:** Compact, direct, and slightly editorial. Large titles use tight tracking and heavy-but-not-black weight; metadata is small, quiet, and tabular where values change.

### Hierarchy
- **Now-playing display** (650, `clamp(30px, 4.2cqw, 58px)`, 1.02, `-0.04em`): the current track or station; at and below 720px it becomes 30px.
- **Page headline** (650, `clamp(24px, 3cqw, 38px)`, 1.12, `-0.055em`): primary destination and task titles; at 390px it resolves to 25px.
- **Section title** (650, 17px, 1.5, `-0.025em`): cards, queue headings, and settings groups.
- **Body** (400, 13px, 1.5): operational copy and standard rows; page subtitles use 1.6 line-height.
- **Metadata** (400–550, 10–12px): row details, provider state, counts, and device status.
- **Label** (650, 9–10px, `0.06em`–`0.13em`, uppercase): source chips, live state, and kickers.
- **Mono data** (400, 10px, 1.5): progress clocks, volume percentages, and diagnostic logs.

**The Inherited Voice Rule.** Do not ship a custom font for FluidMusic. Inherit Hermes typography so the plugin belongs to the desktop shell.

**The Tight-Title Rule.** Tight negative tracking is for display, page, and section titles only. Body copy and controls retain normal tracking.

## Layout

The workspace is a container-query-driven Operate surface. The application uses a 52px top bar above one scrolling content region, with a centered inner width of 1280px and horizontal content padding of `clamp(14px, 3cqw, 42px)`. The broad now-playing band is a three-column grid: Orbit (`170–240px`), flexible playback information (`min 260px`), and Up Next (`min 220px`). It has a 300px minimum height, `clamp(22px, 3cqw, 48px)` gaps, and a single bottom hairline; there is no duplicate footer player.

At a 1440px host viewport, the content remains centered, Orbit can reach 240px, and Up Next stays beside playback behind a vertical divider. The top bar presents the FluidMusic wordmark followed by Browse, Library, Queue, and Settings. Browse and Library use horizontal source tabs below the now-playing band.

At 980px and below, the now-playing band becomes two columns: a 170px Orbit and playback details. Up Next moves to a full-width row beneath them, replacing the left divider with a top divider. Playlist browsing collapses separately below 1080px, and row metadata begins simplifying below 800px.

At 720px and below, the wordmark text hides while its music-note icon remains. Navigation distributes across the available width, Orbit becomes 120px, the band gap becomes 18px, display type becomes 30px, content padding becomes `18px 14px 40px`, and track rows hide source and duration columns.

At the shipped 390px narrow viewport (the `max-width: 460px` behavior), the now-playing band becomes one column. Orbit is 132px and left-aligned; playback and the full-width volume control follow, then Up Next and the destination content. The top bar may grow beyond 50px high, labels remain visible at 11px, the titlebar source label hides, logs become single-column, and all long titles truncate or wrap rather than forcing horizontal page overflow. The narrow screenshot is 390×844; the broad review capture is 1440×960.

Dense collections use line-separated rows rather than floating cards. Media discovery uses an auto-fill grid with 155px minimum tiles, becoming two columns below 580px. Local playlist editing uses a 210px browser rail at broad sizes and a horizontal, scrollable collection strip below 1080px.

**The Stable-Destinations Rule.** Browse, Library, Queue, and Settings remain the only primary workspace destinations; source choices belong in secondary tabs.

**The One-Player Rule.** The now-playing band owns the full workspace playback story. Never add a bottom player bar.

## Elevation & Depth

The system is flat by default. Depth comes from tonal layering and hairline borders: Night behind Graphite, translucent panels over Night, and soft interaction washes within rows. Only temporary or focal objects lift.

### Shadow Vocabulary
- **Orbit lift** (`8px 12px 34px color-mix(in srgb, #000 34%, transparent)`): gives the circular focal object a quiet physical presence.
- **Popover lift** (`8px 16px 46px color-mix(in srgb, #000 42%, transparent)`): separates quick controls from the titlebar and workspace below.
- **Dialog lift** (`0 24px 90px color-mix(in srgb, var(--ui-text-primary) 12%, transparent)`): reserved for modal decisions over a blurred semantic backdrop.
- **Inset state marker** (`inset 0 -2px var(--fm-coral)` or `inset 2px 0 var(--ui-accent)`): marks active navigation and current list rows without adding elevation.

**The Flat-by-Default Rule.** Panels and rows use borders and tonal shifts at rest. Shadows are reserved for Orbit, popovers, dialogs, and inset state markers.

## Shapes

The interface balances one circle against compact rectangles. Orbit and mini-player artwork are circular; its inner artwork is clipped to a circle and a small center label is drawn with an inset disc. Standard controls use 4–6px corners, media artwork and popovers use 8px, panels use 10px, and dialogs use 12px. Source chips are nearly square at 3px to read as metadata rather than pills.

Borders are 1px semantic hairlines. Empty states use a 9px dashed outline; list and queue structure uses dividers instead of card outlines. Runtime artwork is square in tiles and rows, circular only where it represents the now-playing record.

**The One-Circle Rule.** Orbit is the dominant circle. Do not turn every control, chip, tile, or card into a pill or disc.

## Components

### Top Navigation
- **Structure:** a 52px Graphite bar with a compact wordmark and four text destinations.
- **Default / Hover:** secondary text on transparent; hover adds the Soft Interaction Wash.
- **Active:** Warm Ink with a 2px coral bottom inset and no filled tab background.
- **Narrow:** hide only the FluidMusic wordmark text at 720px; keep all four destination labels.

### Orbit Now-Playing Object
- **Shape:** circular, `170–240px` broad, 170px at 980px, 120px at 720px, and 132px at 390px.
- **Material:** Graphite shell, 1px Hairline, 16px broad inset, Night inner field, and an 8px/12px/34px shadow.
- **Content:** runtime provider artwork with `object-fit: cover`, or a violet semantic SVG fallback. No bundled raster fallback.
- **Motion:** while playing, rotate linearly once every 22 seconds. Disable all animation under `prefers-reduced-motion: reduce`.

### Transport and Ranges
- **Controls:** render previous, play/pause, next, seek, and volume only when the active source supports them.
- **Primary action:** uses the Hermes primary Button; compact secondary actions use ghost/icon variants with semantic labels and titles.
- **Progress:** 36px clock columns around a flexible range; clocks and volume use the mono role.
- **Live state:** radio replaces seek with an uppercase coral `LIVE · STATION BROADCAST` line.

### Source Chips and Tabs
- **Source chip:** 3px corners, 1px Hairline, `3px 7px` padding, 9px uppercase text. Radio is coral; Spotify and YouTube are violet; neutral/local sources use secondary text.
- **Secondary tabs:** transparent, horizontally scrollable, and line-based. The selected tab uses Warm Ink plus a 2px violet underline.

### Titlebar Player and Popover
- **Trigger:** compact title, source label, and a 6px status dot; title truncates at 170px. A neighbouring icon action exposes play/pause.
- **Popover:** right-aligned, 390px maximum width, viewport-safe at `calc(100vw - 24px)`, 18px padding, 8px corners, and a maximum height of `min(680px, calc(100vh - 72px))` with internal scrolling.
- **Content:** 76px Orbit, source/title/subtitle, capability-driven transport, progress or LIVE, volume, device context, up to three Up Next items, notices, and YouTube/Open Queue/Open Media shortcuts.
- **Interaction:** the trigger exposes `aria-expanded` and `aria-haspopup="dialog"`; the popover is labelled as a dialog, focuses its first enabled control, closes on Escape or outside pointer input, and restores trigger focus.

### Inputs and Fields
- **Style:** semantic secondary background, 1px Hairline, 6px corners, and `10px 12px` padding.
- **Focus:** every plugin control receives a 2px `var(--ui-accent)` outline with a 3px offset through `:focus-visible`.
- **States:** placeholders use tertiary text; disabled actions remain native Hermes Button states; errors use a 3px accent edge and Soft wash.

### Panels, Rows, and Empty States
- **Panels:** Panel Veil, 1px Hairline, 10px corners, and 22px padding (16px below 580px).
- **Rows:** 12px vertical rhythm, bottom hairlines, Soft hover, tabular numbers, and compact 40px artwork (32px below 580px).
- **Current queue row:** Soft wash plus a 2px semantic accent inset.
- **Empty state:** 9px dashed border, centered icon and copy, and a clear recovery action where one exists.

### Local Collections and Legacy Mixes
- **Local collections:** editable, local-only, and presented through the standard playlist browser/editor treatment.
- **Legacy mixes:** visibly labelled `Legacy mix · read only`, followed by a notice explaining preservation. They expose Play, Add to Up Next, and Export, but no mutation controls.
- **Provider ownership:** Spotify playlists remain in Spotify; cross-source listening belongs to temporary Up Next, not new saved collections.

### Provider Capability Rules
- **Spotify:** play, previous, next, seek, volume, shuffle, repeat, and device context are supported; actual rendered transport currently exposes only applicable shared actions plus device state.
- **Radio:** play and volume only; use LIVE instead of seek and omit previous/next.
- **Local:** play, previous, next, seek, and volume.
- **YouTube:** play, previous, next, seek, and volume only through FluidMusic’s owned Browser tab state.
- **Rule:** omit unsupported controls rather than disabling or simulating them.

### Accessibility and Motion
- Semantic headings, `nav`, `main`, `section`, `aside`, native dialogs, buttons, inputs, and ranges carry explicit labels or visible text.
- Focus is visible across workspace, dialog, mini-player, and titlebar surfaces.
- Dialogs focus an actionable element, close through native cancel/Escape behavior, and restore prior focus.
- Status and errors use `role="status"` or `role="alert"`; ranges expose labels and volume value text.
- Decorative artwork images use empty alternative text because adjacent labels carry the track identity; fallback icons are `aria-hidden`.
- `prefers-reduced-motion: reduce` disables animation, transitions, and smooth scrolling across all plugin surfaces. Orbit rotation is the only shipped decorative motion.

## Do's and Don'ts

### Do:
- **Do** build every surface from Hermes semantic variables plus the fixed coral and violet signals.
- **Do** keep Orbit as the single memorable focal object and let runtime artwork supply its content.
- **Do** preserve all four primary destinations and use secondary tabs for provider or section changes.
- **Do** render controls from active-source capabilities and state the provider/device boundary in copy.
- **Do** distinguish editable local collections from read-only legacy mixes through labels, notices, and available actions.
- **Do** test broad, 980px, 720px, and 390px container behavior, visible focus, keyboard dismissal, and reduced motion.

### Don't:
- **Don't** use green-tinted backgrounds, Spotify-green panels, or provider-colored page washes.
- **Don't** add a sidebar-plus-bottom-player streaming shell or duplicate the now-playing controls in a footer.
- **Don't** ship raster artwork, texture, or placeholder imagery; provider artwork is runtime content and SVG supplies fallbacks.
- **Don't** show fake seek, previous, next, shuffle, repeat, queue, or device actions where the active source cannot perform them.
- **Don't** make new saved collections cross-source; use temporary Up Next for mixed listening and preserve legacy mixes as read-only.
- **Don't** replace hairline structure with stacks of floating cards, broad shadows, excessive pills, or decorative animation.
