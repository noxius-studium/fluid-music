# FM-17 receipt — Safe local collections, legacy mixes and import/export continuity

Task: FM-17 (t_e9550478) · Board: fluid-music · Card: `kanban/FM-17.md`
Requirements: F05, F19, F21, F22, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: c7383e4d13ca7cfa6d60505dbaa1906d49c8df97 (remote read-back equal; tree clean).

## 1. Audit result — contract already implemented, preserved unchanged

- Raw legacy preservation: `rawPlaylistRoot` + `rawLegacyPlaylists` keep the exact stored root and legacy entries; initialization never normalize-and-persists; `playlistStorageState` writes raw legacy records back verbatim beside normalized new collections; export emits raw legacy; import re-homes raw legacy under a new id.
- Editable collections are local-only with safe `localTrackId` serialization (`serializePlaylistItem` strips filePath/objectUrl/unknown keys); session files refused; legacy mixes read-only (every mutation refused) with play/enqueue/export retained; exact-occurrence `moveInPlaylist` with integer/bounds guards; bounded import (2MB / 200 playlists / 10000 items, all-or-nothing validation); unavailable tracks skipped honestly without rewriting saved data.
- Existing suites already cover bulk edit/dedup/undo, new-collection export/import round-trip, legacy mutation refusal, raw-shape survival of unrelated writes, duplicate occurrence enqueue/play. **No production defect found; no production code changed.**

## 2. New fixtures closing the remaining acceptance gaps

`tests/collections-legacy.test.mjs` (NEW, 4, labelled headless doubles + in-memory storage):
1. Exact-occurrence reorder with duplicates moves only the chosen row; out-of-bounds/non-integer moves inert; reorder persisted; listening queue untouched.
2. Legacy export → import → re-export round-trip preserves raw unknown nested fields, duplicate order and unknown root fields under a new id; imported copy stays read-only; original raw record untouched; enqueue still works.
3. Persistence secrecy: stored queue carries only safe keys (no objectUrl/filePath/handles); session-only local excluded; loopback capability URLs rejected as durable references and secrets never reach storage; collection writes retain safe localTrackId metadata only; volume/autoplay/view/mute writes leave playlistState byte-identical.
4. Unavailable tracks: enqueue skips with honest count, unavailable selection refused without queue change, playback rebuilds from playable rows only, saved collection byte-identical throughout.

Fixture-harness note: fully synchronous tests that stub global timers can stall the `node --test` child's own scheduling; the two sync-shaped fixtures yield once (`await flush()`) so the runner finalizes cleanly. No production impact.

## 3. Changed files

- `tests/collections-legacy.test.mjs` — NEW.
- This receipt.
- No production source change; `desktop/plugin.js` untouched (`build --check` clean).

## 4. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **139 tests, 138 pass, 1 fail, 0 cancelled** — only the pre-existing FM-18 stale Spotify-discovery-copy assertion (FM-18 owns it).
- `.venv/bin/python -m pytest -q` → **130 passed**.
- `build_desktop.py --check` → exit 0.
- No real user collections/files/provider data touched; no downloads/Docker/paid calls.

## 5. Honest boundaries

- Headless controller/storage doubles only. Live Desktop collection UI, drag/reorder rendering and file-picker import/export remain **UNVERIFIED**, gated to FM-25.

## 6. Commit / push

- Commit SHA + parent + verified remote SHA: recorded in the board CALLBACK FINISH for t_e9550478 (this receipt is part of that same commit). Author Zero2 <deadtrix21@users.noreply.github.com>; push target docs/cloud-kanban-handoff only.
- Remaining dirty work after commit: none. Carried: FM-18 Settings/discovery copy (last stale node assertion), FM-19 keyboard/disposal audit, FM-22 recovery, FM-23 adapter, FM-24 artifact + stale docs, FM-25 owner review.
- Next card: FM-18 (t_41015ffb) — dedicated Settings, truthful status and sanitized diagnostics. Continuing serially.
