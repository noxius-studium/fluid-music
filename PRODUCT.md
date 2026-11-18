# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

FluidMusic is primarily for a Hermes Desktop user who listens while working in chats and other panes. The user needs immediate playback control without leaving the current conversation, with a deeper workspace available for browsing, local-library management, and setup.

## Product Purpose

FluidMusic gives Hermes Desktop one coherent listening surface across Spotify Connect, internet radio, local music, and potentially browser-based YouTube listening. Success means the current source is obvious, the controls match what that source can actually do, and routine listening never requires opening the full Media workspace.

## Positioning

FluidMusic is a source-aware listening dock inside Hermes rather than a pretend universal playback engine. It keeps each provider's real ownership and capabilities visible while presenting one compact, dependable control surface.

## Operating Context

- The compact titlebar dock is the primary everyday surface while the user works in a chat.
- The full Media workspace remains available for browsing, local-library management, provider setup, diagnostics, and tasks that need room.
- Spotify playback occurs on a selected Spotify Connect device.
- Radio and local music play inside Hermes.
- YouTube runs through Hermes's internal Browser using the patched owned-preview contract: FluidMusic opens or focuses one keyed tab, retains its opaque handle for the current app lifetime, and executes consented media commands only in that handle.

## Capabilities and Constraints

- Preserve working Spotify Connect, internet-radio, and local-file behavior.
- Keep controls capability-driven: never show fake seek, next, queue, device, shuffle, or repeat actions for a source that cannot support them.
- Replace the current status-bar-heavy quick-control experience with a compact titlebar dock and popover inspired by the proven YouTube Dock interaction pattern.
- Playback, the selected track, queue position, active source, and compact-dock state are application-level FluidMusic state. Switching Hermes sessions or chats must not change songs, advance the queue, select a different source, reopen another destination, or move focus to another pane.
- Internal-Browser destinations may follow the focused chat only when the user explicitly opens one there; chat focus changes must never be interpreted as playback intent.
- Keep the full Media workspace, but redesign its hierarchy and visual presentation.
- Remove the audio visualizer from the product surface and avoid spending runtime work on decorative playback graphics.
- Provider playlists stay provider-owned. FluidMusic owns local playlists and a temporary cross-source Up Next queue; existing mixed playlists remain readable/exportable as legacy data until migration is complete.
- Keep persistent local-library indexing and approved-folder boundaries.
- Preserve accessibility, responsive pane behavior, active-theme compatibility, and honest error/recovery states.
- YouTube becomes a first-class controllable source through the new Hermes host capability for a stable app-owned Browser tab handle. Focus-dependent DOM scripting is not acceptable as global playback control.
- FluidMusic keeps one restart-restorable, temporary cross-source Up Next queue because it enables explicit Spotify → local → radio → YouTube handoff without pretending to own provider libraries.

## Brand Commitments

- Product name: FluidMusic.
- Voice: direct, calm, source-honest, and useful while the user is working.
- Chosen visual direction: Night Radio is the main dark workspace—calm navy structure, clear source hierarchy, compact top navigation, and aligned Up Next information. Port Orbit Player's large circular record/artwork object into the now-playing region as the memorable focal point without sacrificing operational density.
- The YouTube Dock plugin at `C:\Users\JSuic\HermesHome\desktop-plugins\hermes-youtube-dock\plugin.js` is a binding interaction reference for compact titlebar discovery and an internal-Browser handoff, not a visual skin to copy mechanically.

## Evidence on Hand

- Existing production-oriented implementation and behavior documentation in this repository.
- Automated UI fixtures and screenshots under `.hermes-tests/ui/`.
- Existing YouTube Dock implementation at `C:\Users\JSuic\HermesHome\desktop-plugins\hermes-youtube-dock\plugin.js`.
- No approved artwork pack, commercial claims, customer evidence, or proven direct-control bridge into the internal YouTube Browser page.

## Product Principles

1. Quick control first; deep management remains available but never blocks listening.
2. Provider truth beats visual uniformity: controls and copy must reflect the active source's real capabilities.
3. One obvious owner per task: provider libraries stay with providers, while FluidMusic owns local-library organization and only the cross-source state that creates clear value.
4. Quiet in the shell, spacious in the workspace: compact surfaces should not compete with the user's conversation.
5. A control is not complete until its live effect and failure state are verified.

## Accessibility & Inclusion

Retain keyboard operation, visible focus, semantic labels, reduced-motion support where motion remains, responsive behavior down to narrow panes, and WCAG 2 AA checks for the plugin-owned UI.
