# Requirement coverage

Every original retained/explicit requirement below has at least one detailed card. Duplicate mappings indicate shared constraints, not extra features.

| Requirement | Meaning | Cards |
|---|---|---|
| F01 | Continue the existing latest source, not the old main branch or a regenerated music app. | FM-00, FM-23, FM-24, FM-25 |
| F02 | Hermes is the sole theme authority, including light/dark/glass/accent changes. | FM-13, FM-14, FM-18, FM-24, FM-25 |
| F03 | Retain the selected Night Radio hierarchy, Orbit object and compact Blackstage-style navigation without recreating the rejected website-sized shell. | FM-13 |
| F04 | Keep app-scale titles, dense metadata and useful content instead of oversized headings. | FM-13 |
| F05 | Retain Browse, Library, Queue and Settings and all applicable existing source workflows. | FM-05, FM-06, FM-11, FM-13, FM-15, FM-16, FM-17, FM-18 |
| F06 | No redundant permanent sidebar row; plugin Settings, titlebar and existing route provide discovery. | FM-13, FM-18 |
| F07 | Keep app-level titlebar discovery and usable quick-control popover. | FM-02, FM-14, FM-25 |
| F08 | Preserve optional dockable mini-player and one integrated YouTube surface, not a second provider pane. | FM-02, FM-04, FM-08, FM-14, FM-25 |
| F09 | Keep the SAME bottom-anchored transport bar across all active sources and relevant player surfaces. | FM-04, FM-10, FM-12, FM-13, FM-14, FM-15, FM-16, FM-24, FM-25 |
| F10 | Play/pause, previous/next, seek and volume must have real capability-correct effects and honest failure states. | FM-03, FM-04, FM-10, FM-12, FM-15, FM-16, FM-19, FM-25 |
| F11 | Provide a usable volume slider, not the rejected tiny range or an embedded-player volume excuse. | FM-12, FM-14, FM-25 |
| F12 | Scale to real Electron pane bounds, short panes, narrow layouts and long text without clipping controls. | FM-12, FM-13, FM-14, FM-19, FM-25 |
| F13 | Preserve the working integrated YouTube embed route; do not restore focus-dependent Browser scripting or extra embedded-player chrome. | FM-01, FM-04, FM-05, FM-07, FM-08, FM-24, FM-25 |
| F14 | Protect the loopback capability host, allowed origins and messages; preserve single ownership and stale-transition fencing. | FM-01, FM-04, FM-07, FM-08, FM-19, FM-22 |
| F15 | Provide YouTube song/video search and real safe titles/metadata with bounded errors, not invented results. | FM-05, FM-06, FM-07, FM-11, FM-25 |
| F16 | Keep durable profile-scoped SQLite playback history and truthful played-state semantics. | FM-06, FM-16, FM-21, FM-25 |
| F17 | App-level controller identity, item, queue, source, playback and pane do not change with chat/session/route focus. | FM-02, FM-03, FM-04, FM-08, FM-14, FM-19, FM-25 |
| F18 | Exactly one active engine; all provider transitions go through one serialized coordinator. | FM-02, FM-03, FM-08, FM-10, FM-15, FM-22, FM-25 |
| F19 | Keep Up Next ordering, correct duplicate occurrences, restart-safe references and exactly-once completion. | FM-02, FM-03, FM-06, FM-08, FM-10, FM-17, FM-20 |
| F20 | Preserve internet radio discovery, pinned stations, direct playback and LIVE semantics. | FM-15 |
| F21 | Preserve approved-folder local indexing, stable SQLite IDs, safe seekable media and unavailable-file recovery. | FM-16, FM-17 |
| F22 | Retain editable local-only collections and preserve read-only legacy mixes and unknown saved data. | FM-11, FM-17, FM-20 |
| F23 | Keep dedicated plugin settings, provider status and sanitized actionable diagnostics. | FM-09, FM-18, FM-19, FM-22 |
| F24 | Consistent semantic SVG/host icons, keyboard/focus/ARIA and reduced-motion support on every touched surface. | FM-12, FM-13, FM-14, FM-19, FM-20, FM-21, FM-25 |
| F25 | Deliver the full unified backend/renderer package and declare real host SDK compatibility, not only a demo. | FM-00, FM-01, FM-09, FM-23, FM-24, FM-25 |
| F26 | No Docker, heavyweight stacks, large installs or intensive test matrices; use small serial checks and SQLite/test doubles. | FM-00, FM-22, FM-24, FM-25 |
| F27 | Cloud main and every delegated worker use exactly qwen/qwen4-max:free; provider verified from actual cloud profile. | FM-00, FM-25 |
| F28 | Scoped commit then push then remote verification; callbacks; continue until done or genuine user review. | FM-00, FM-24, FM-25 |
| F29 | Spotify is INCLUDED; all providers live in FluidMusic, not other Hermes plugins/core provider implementations. | FM-01, FM-09, FM-10, FM-11, FM-18, FM-23, FM-24 |
| F30 | Protect existing data, credentials, private media/history and live app; do not restart Hermes or mutate installation during preparation. | FM-00, FM-01, FM-06, FM-09, FM-16, FM-17, FM-18, FM-22, FM-23, FM-24, FM-25 |
| F31 | Own Spotify PKCE/token refresh/client, account/device/capability and actual transport integration. | FM-09, FM-10, FM-11 |
| F32 | Investigate real failing YouTube videos and classify embed/configuration/autoplay/account/content causes. | FM-07, FM-08 |
| F33 | Integrated legitimate first-party watch fallback for eligible embed-denied videos; no quiet external/plugin substitution. | FM-08 |
| F34 | New queue Play next, multi-edit, undo and provenance actions with stable occurrence identity. | FM-20 |
| F35 | Named resumable listening sessions with safe references and explicit replace/append restore. | FM-20, FM-21 |
| F36 | Eligible long-form resume/timestamp bookmarks and searchable history with retention controls. | FM-21 |
| F37 | Source-aware sleep timer/end-of-item with visible state and cancellation. | FM-21 |
| F38 | Bounded failure recovery, source-health diagnostics, backoff and actionable retry/skip. | FM-07, FM-22 |
| F39 | Public-SDK adapter, capability negotiation and upgrade resilience without private host patches. | FM-08, FM-23 |
| F40 | Data-safe migrations, reload/disposal/rollback, resource budgets and lightweight N/N+1 compatibility checks. | FM-22, FM-23 |
