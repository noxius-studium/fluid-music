# FM-20 receipt — Queue edit/undo/provenance and resumable listening sessions

Task: FM-20 (t_b8b1f7b0) · Board: fluid-music · Card: `kanban/FM-20.md`
Requirements: F19, F22, F24, F34, F35 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 68d9d87c41d46aed6969abe4ab24d4a291d15f6f (remote read-back equal).

## 0. Resume provenance (container restart)

Run 24 claimed FM-20 at 15:54 UTC and posted CALLBACK START at 15:57; the container restart (~16:03) killed the worker before any FINISH/progress comment. The resumed session verified no live worker existed (process inspection; gateway dispatch held), reclaimed the stale lock, re-claimed (ttl 3600) and posted a RESUME comment. The 8-file dirty partial implementation was preserved and audited against the START scope — no work was recreated or replayed.

## 1. Implemented scope (inside existing surfaces, no new primary tabs)

1. **Queue editing + provenance (F34):** `addNext` (inserts directly after the exact current occurrence, never steals selection; empty queue selects paused, never autoplays), existing `add` gained an origin parameter, `removeQueueItems` / `moveQueueItems` (occurrence-object-safe multi-select), `clearUpcoming` (current item keeps playing) vs existing `clearQueue`. Origin facts (`search`/`history`/`collection`/`provider`/`library`/`session`) attached at call sites (SearchPage, RadioPage, YouTube results, HistoryPage, PlaylistEditor, LegacyPlaylist, Spotify library/playlist rows, LocalPage, opened files, collection play/enqueue) and rendered as a `fluid-queue-origin` row caption. Origin is display-only: `persist()` serializes via `serializePlaylistItem`, so no origin metadata is stored or restored.
2. **One-step deterministic undo:** `queueUndo` atom snapshots queue+index before each edit (add, addNext, remove, bulk remove/move, reorder, clear, clear-upcoming, open files, collection play/enqueue, session append/restore). Undo restores the exact data; it stops the engine and pauses ONLY when the current occurrence actually changed, and never auto-resumes. Exactly one step: a second undo is an honest no-op.
3. **Resumable listening sessions (F35):** separate `listeningSessions` storage key, `normalizeListeningSessions` re-serializes every stored item through `serializePlaylistItem` on load (blob handles, raw paths and capability URLs can never survive), bounded 50 sessions × 500 items, names ≤ 120 chars. Save skips session-only opened files with an honest count; Restore opens a preview dialog listing unavailable items with reasons and offers Replace/Append INSIDE the interaction; Replace stops the current engine and loads paused (no autoplay); Append keeps the current selection; Delete is behind Confirm. Sessions are distinct from writable local-only collections; no startup autoplay anywhere.
4. **Contextual UI (F24):** QueuePage selection toolbar (`role=toolbar`, Move up/down, Remove selected, Clear selection), per-row native checkboxes with `Select … (position N)` labels, Undo/Clear upcoming/Save session actions, session rows with Restore…/Delete, native Modal/Confirm dialogs reusing existing anatomy. Stale selections are dropped whenever the queue changes (`useEffect` on queue identity — the existing PlaylistEditor pattern). Scoped CSS adds origin captions, selectable-row grids and session rows, with `@container fluid (max-width:580px)` narrow rules; reduced-motion support preserved.

## 2. Audit fixes applied to the preserved partial work

1. `removeQueueItems` auto-played the successor even when paused; now mirrors single-row `remove()` semantics (continue only if `wasPlaying`, otherwise pause) and resets progress/Spotify queue guard/anchor when the current occurrence changes.
2. `playPlaylist`, `enqueuePlaylist` and `openLocalFiles` mutated the queue without an undo snapshot; all three now participate in one-step undo.
3. `saveListeningSession` persisted session-only opened files as dead `unavailable` references; now skipped with an honest count, and `normalizeListeningSessions` also drops such references on load (defense in depth).
4. Indexed local-library rows were labelled `From provider`; added an honest `library: 'From local library'` origin (small deliberate extension of the START origin set — local library is first-party, not an external provider).
5. QueuePage selection could go stale after single-row edits; added the queue-identity selection reset.

## 3. Fixtures (labelled headless doubles, in-memory storage only)

`tests/queue-sessions.test.mjs` (NEW, 12 tests):
- Pure: session normalization bounds (50×500), name truncation, secrecy (no blob:/filePath/objectUrl/capability URLs/session-only refs), garbage dropping, origin labels incl. unknown → '', no new primary workspace tab.
- Play next occurrence identity with duplicate IDs, no selection steal, empty-queue paused, invalid-item refusal.
- Provenance validated at attach, never persisted, never fabricated on reload.
- Bulk remove: index shift, exact current-object survival, paused-remove never autoplays, playing-remove continues with successor, remove-all idle, inert out-of-range, exact undo restore.
- Bulk move: duplicate occurrence identity, current follows, bounds/direction inert, undo of last move only.
- Clear upcoming keeps current playing; clear-all + undo deterministic and paused.
- One-step undo: last edit only, second undo false, unchanged occurrence keeps playing.
- Sessions: safe save + session-only skip count, secrecy of stored JSON, 50 bound, name bound, delete, reload round-trip through a fresh controller sharing only the storage double, unavailable-local preview, filtered Replace (paused, no autoplay), Append keeps selection, registered-local re-preview.
- All-unavailable restore refused honestly, queue untouched.
- Collection play/enqueue and opened files undoable.
- Static UI anatomy: contextual toolbar, Confirm/Modal dialogs, Replace/Append review copy, Play next action, origin caption, checkbox labels, selection-reset effect, narrow container rules, reduced motion, unchanged primary tab set.

Harness maintenance (mechanical, no behavior change): the controller region now references `QUEUE_ORIGINS`, `normalizeListeningSessions` and `makeId`; all 15 existing controller-extraction harnesses were threaded with these three pure symbols (param names + arguments + pure return lists). `tests/history-ux.test.mjs` static replay expectation updated to the stronger origin-aware form `controller.add(entry.item, true, 'history')`.

## 4. Changed files

- `desktop/src/10-model.js` — QUEUE_ORIGINS (+library), queueOriginLabel, normalizeListeningSessions.
- `desktop/src/30-controller.js` — queue edit/undo/provenance + listening-session use cases; audit fixes §2.
- `desktop/src/40-ui.js` — TrackRow origin prop + Play next action; QueueEntry selection/origin; QueueList pass-through.
- `desktop/src/41-library.js` — search/provider/library/session origins at call sites.
- `desktop/src/42-playlists.js` — QueuePage bulk/undo/sessions UI + selection reset; collection origins.
- `desktop/src/44-workspace.js` — YouTube search + history replay origins.
- `desktop/src/20-styles.js` — scoped origin/selectable/session CSS + narrow rules.
- `desktop/plugin.js` — regenerated (`--check` clean, ESM OK).
- `tests/queue-sessions.test.mjs` — NEW; 15 existing test harnesses symbol-threaded; history-ux expectation strengthened.
- This receipt.

## 5. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **158 tests, 158 pass, 0 fail, 0 cancelled** (includes the 12 new FM-20 fixtures).
- `.venv/bin/python -m pytest -q` → **130 passed** (backend untouched by FM-20; regression guard).
- `python3 scripts/build_desktop.py` + `--check` → bundle in sync, clean.
- `node --input-type=module --check < desktop/plugin.js` → ESM syntax OK.
- No Docker/downloads/paid calls/live providers; serial lightweight suite only.

## 6. Fixture versus live evidence

All evidence above is headless-fixture evidence: labelled Audio/timer/URL/storage doubles and static bundle anatomy. NOT proven here: real sound, live Queue UI rendering/keyboard traversal at 320–390px, packaged Electron behavior, live Spotify/YouTube/radio provider availability during restore preview. Restore preview availability is reference-level (supported source + registered local file); live provider state remains an FM-25 owner review boundary. Backend SQLite history/collections are untouched; session persistence uses the host storage boundary and its round-trip is proven with the in-memory storage double.

## 7. Protected paths (untouched)

.env/auth/token stores, real plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, backend modules, provider transport semantics, legacy playlist raw preservation, historical docs, unrelated fragments.

## 8. Remaining acceptance and next card

- Owner audio/theme/UI review of Queue editing, undo, provenance captions and listening-session restore flows: FM-25 (t_0bbb3bc2), explicitly unverified here.
- Commit SHA/parent/author and verified remote SHA: recorded in the CALLBACK FINISH comment (this receipt is committed with the work).
- Next existing card: FM-21 (t_89cbd2bb) — long-form bookmarks/resume, history filters and sleep timer.
