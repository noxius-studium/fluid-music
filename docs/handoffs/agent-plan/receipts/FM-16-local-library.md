# FM-16 receipt — Approved local-library scanning, IDs and seekable playback

Task: FM-16 (t_3126fef7) · Board: fluid-music · Card: `kanban/FM-16.md`
Requirements: F05, F09, F10, F16, F21, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: bde73c1fe98e3f0c20b19fae1f034f9f653847ab (remote read-back equal; tree clean).

## 1. Audit result — contract already implemented, preserved unchanged

`dashboard/local_library.py` + local routes + renderer local adapter were audited against the card; **no production defect found, no production code changed**:

- Explicit approved roots only: `add_root` requires an absolute, existing, readable folder (file paths approve their parent; NUL/oversize rejected; symlinked roots resolved once at approval). Host folder picker (`os.pickOpenPath`) is the approval surface.
- Scan bounds: extension allowlist (.aac/.flac/.m4a/.mp3/.oga/.ogg/.opus/.wav/.webm), 50,000-track safety limit with transactional rollback, sorted deterministic walk, `os.walk(followlinks=False)` + symlinked-file skip.
- Bounded fingerprints: size + first/last 64KB only — never whole-file reads, no audio bytes in SQLite.
- Stable identities: uuid5 over canonical path; move/rename relink ONLY when exactly one missing row shares the fingerprint (unambiguous); ambiguous candidates keep their rows and the new file gets a new identity.
- Unavailable rows retained (`available=0`), never deleted; reads recheck the filesystem without waiting for a rescan; missing roots mark their tracks unavailable with an honest per-root scan error.
- `remove_root` deletes index rows only (FK cascade) — audio files are never touched; re-approval rebuilds the same stable IDs.
- Seekable playback: renderer holds no raw filesystem authority — `normalizeQueueItem` rejects local items without an indexed `localTrackId`/blob handle; `add()` revalidates durable history/queue references against the CURRENT library; playback resolves through the host `hermes-media://stream|remote/{encoded}` protocol with a blob → stream → remote fallback chain, honest unavailable/codec errors, real seek/progress via the media element, queue-level ended advance. Capability table gives local play/previous/next/seek/volume. All renderer behavior already fixture-covered by fluid-music.test.mjs / history-ux / focus-continuity suites (passing unmodified).

## 2. New bounded fixtures (tiny temporary labelled files + isolated tmp SQLite)

- `tests/test_local_library.py` (NEW, 8): missing→unavailable row retained→restore with same ID; ambiguous fingerprint never relinks; root removal never deletes audio (+ re-approval same IDs); symlinked dirs/files excluded; extension allowlist + root confinement + root validation (relative/missing/NUL/file→parent); read-time availability without rescan; scan limit bounded + rollback (monkeypatched small constant, labelled); fingerprint is exactly size+head+tail with distinct path IDs.
- `tests/test_plugin_api.py` (+1): route-level `DELETE /local/roots/{id}` keeps the audio file on disk and empties the index.

## 3. Cloud filesystem vs owner Desktop media boundary (acceptance doc)

- The cloud workspace `/home/node/fluid-music` and any Linux path scanned here are **index/provenance fixtures only**. A Linux cloud path is NOT a playable track on the owner's Windows Desktop, and Windows media roots are not cloud media roots.
- Actual playback authority is the Desktop host's seekable media protocol (`hermes-media://`), resolved at runtime against the owner's approved folders on the machine where the host runs. Range/seek capability, codec support and real audio output are host properties that a headless cloud fixture cannot prove.
- The backend never streams or proxies local audio bytes over HTTP; it only serves catalog metadata. No cloud-wide music catalogue is created, and the owner's filesystem is never scanned by this mission.
- **Unverified live (FM-25 gate):** Windows media access, host protocol range behavior, real decoding/seek/audio, packaged-Desktop library UI.

## 4. Changed files

- `tests/test_local_library.py` — NEW.
- `tests/test_plugin_api.py` — 1 route test appended.
- This receipt.
- No production source change; `desktop/plugin.js` untouched (`build --check` clean).

## 5. Checks and ACTUAL results

- `.venv/bin/python -m pytest -q` → **130 passed** (121 baseline + 8 library + 1 route).
- `node --test tests/*.test.mjs` → **135 tests, 134 pass, 1 fail** — only the pre-existing FM-18 stale Spotify-discovery-copy assertion.
- `build_desktop.py --check` → exit 0 (bundle unchanged).
- No owner-library access, no large scans, no real audio decoding, no downloads/Docker/paid calls.

## 6. Commit / push

- Commit SHA + parent + verified remote SHA: recorded in the board CALLBACK FINISH for t_3126fef7 (this receipt is part of that same commit). Author Zero2 <deadtrix21@users.noreply.github.com>; push target docs/cloud-kanban-handoff only.
- Remaining dirty work after commit: none. Carried: FM-18 Settings/discovery copy, FM-19 keyboard/disposal audit, FM-22 recovery, FM-23 adapter, FM-24 artifact + stale docs, FM-25 owner review.
- Next card: FM-17 (t_e9550478) — safe local collections, legacy mixes and import/export continuity. Continuing serially.
