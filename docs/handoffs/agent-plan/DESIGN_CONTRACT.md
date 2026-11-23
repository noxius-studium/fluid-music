# Current design contract and conflict resolution

## Authority and deliberate retained character

The owner selected Night Radio's hierarchy with the Orbit circular artwork object and compact Blackstage-style navigation. Later corrections take precedence over the historical DESIGN.md and old screenshots: use Hermes themes, shrink website-sized headings, restore bottom controls for ALL sources, make volume usable, integrate YouTube into the existing player, and remove redundant sidebar discovery. Do NOT restore the old private navy/coral/violet palette, 'no green host theme' rule, 58px titles, 240px forced hero or 'never add a bottom bar' rule from older material.

Old PRODUCT.md/README/architecture still describe an owned Browser and old Spotify imports in places. Current source has a capability-protected backend loopback embed host, YouTube search/resolve and SQLite history. Preserve that working path. The owner's historical confirmation that YouTube played is evidence of that session, NOT fresh end-to-end acceptance on the cloud or this machine.

## Semantic role/state mapping — no private palette

| Role | Hermes authority / behavior |
|---|---|
| Page ground | Host pane; transparent plugin root, no private skin/background wash |
| Main text | `var(--ui-text-primary)` |
| Supporting metadata | `var(--ui-text-secondary)` |
| Placeholder/lesser detail | `var(--ui-text-tertiary)` |
| Quiet status | Actual state plus `var(--ui-text-quaternary)` where available; never color alone |
| Panel | `color-mix(in srgb, var(--ui-bg-secondary) 80%, transparent)`; match current source |
| Input | `var(--ui-bg-secondary)` plus semantic text/stroke |
| Elevated popover/dialog | Host elevated/secondary semantic surface, opaque enough for legible overlap; no fixed black |
| Hairlines | `var(--ui-stroke-secondary)` |
| Hover/selected | `color-mix(in srgb, var(--ui-accent) 9%, transparent)` and actual selected state |
| Focus | 2px `var(--ui-accent)` outline, 3px offset; never remove keyboard focus |
| Active source/live | Actual state text/icon plus host accent; do not infer playing merely from selected item |
| Disabled | Host Button/Range disabled behavior and explanatory label, not fake working opacity |
| Busy | Same geometry, short action-specific status, prevent duplicate command; never falsely advance history |
| Failure | Sanitized useful error + retry/corrective action; no tokens/raw provider HTML |

All values remain live to the chosen Hermes theme, including intentionally tinted themes. No font download, private theme switch or fixed hex fallback. Scope style changes to FluidMusic. Prefer existing SDK Buttons/Dialog/Popover/Tabs/Input/Slider where exported; verify runtime export compatibility before named imports. Avoid app-internal imports or another plugin dependency.

## Concrete desktop composition (target dimensions, not claims of measured approval)

- Root fills its actual pane: `height:100%`, `min-height:0`, `min-width:0`; body/player layout uses `grid-template-rows:minmax(0,1fr) auto`. Only the content body scrolls. Shared bottom transport never scrolls away, overlays rows or leaves dead space below it.
- Header is a compact 40–44px operational strip with small product mark and Browse, Library, Queue, Settings. Preserve source sub-tabs within the relevant destination. No extra permanent sidebar entry. Plugin Settings and titlebar remain discoverable.
- Body uses 14–18px padding and 12–18px section spacing, not a giant marketing hero. Page title 19–25px, section title 15–17px, body 12–13px, metadata 10–12px; long titles truncate with an accessible full name or wrap safely.
- Orbit remains an optional overview focal object: 160–200px where space exists, 96–120px in narrow overview; mini-player artwork 40–64px. Do not force it above controls in a short pane. No analyser/visualizer is reintroduced because a source filename contains 'visualizer'.
- Broad shared player bar: target 64–72px, 12px inline padding, three regions: selected item/art at left, centered transport/seek or LIVE, volume/source at right. Main play target 36–40px; secondary 28–32px; icons 16–18px, same stroke vocabulary across providers.
- Narrow shared bar: reflow to 96–112px in two rows, preserve play/pause, applicable skip, progress/LIVE and volume. Collapse decorative/source detail before dropping controls. The volume row prefers 150–170px of usable width or fills the row; do not retain the rejected hard 60px compact slider when the surface can reflow.
- Queue/list rows preserve stable identity and occurrence, 32–40px art, flexible title, provider/availability facts and explicit actions. In a narrow container move secondary actions to a second row; do not turn item text into horizontal root overflow.
- Primary icon vocabulary: play/pause, previous/next, speaker/mute, search, list/queue, folder/local, broadcast/radio, clock/history, gear/settings. Reuse common components, 16–18px nominal, 1.5–1.8 stroke, decorative icons hidden from assistive tech and all actionable icon-only controls named.

## Main Media workspace

Browse retains actual YouTube search/URL entry, radio discovery and the included FluidMusic-owned Spotify integration. Results show actual title/source/artwork and distinguish resolving/loading/empty/network error. A play action goes through the shared coordinator; enqueue doesn't unexpectedly start another source. Library preserves approved local folders/tracks, local collections, legacy mixes, and playback history; Queue shows Up Next and current occurrence; Settings has actual connection, local-library, display and sanitized diagnostics controls. Audit existing source navigation and include every retained action, not just these headings.

## Titlebar popover and mini-player

- Titlebar: quiet current title/status and explicit play/pause, not an always-open page header. Closed popover does not stop polling/active playback. Source label may hide before actual transport.
- Popover width at most 390px and `calc(100vw - 24px)`; maximum height `min(680px, calc(100vh - 72px))`; compact summary, applicable controls, usable volume, short queue and Open Media/Queue. Escape/outside click close; restore trigger focus. Do not open Browser or steal pane focus on session switch.
- Mini-player is the existing dockable FluidMusic pane, not a dedicated YouTube pane. Audio-only layout targets 320px width and a short ~220px body; YouTube needs its documented video viewport plus controls, so target at least ~360px height or expand the same pane instead of shrinking the video below 200x200: compact summary/art/video region above the SAME bottom bar; prefer a smaller art/video region rather than clipping controls. Declare unavoidable physical minimum instead of pretending everything fits.
- YouTube video lives within that one existing player surface. No second 'YouTube Video Embedded player' card/window, duplicate native/custom controls, or the rejected permanent 'volume is controlled by the embedded player' notice. Native embed internals are not permission to claim custom volume works. Preserve provider policy/embedding restrictions; no download/DRM/ad bypass.

## Responsive and interaction review

Use container width/height, not global window width or screenshot pixels. Broad 1200–1440, medium 720–980, narrow 320–390, short mini-pane and open popover are representative checks run sequentially with existing tools/manual review, not a browser farm. Test long/unknown title, missing art, long source, busy/error/disabled/no selection, keyboard-only, live theme change, focus return and reduced motion. Report missing live evidence rather than fetching a large browser or launching full Electron on the cloud.
