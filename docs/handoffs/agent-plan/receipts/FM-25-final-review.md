# FM-25 final receipt — lean checks complete; OWNER REVIEW GATE (parked)

Task: FM-25 (t_0bbb3bc2) · Board: fluid-music · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Final source SHA: 1a52f0892ab8c740b876046c01673aa45226fcf6 (remote ls-remote read-back EQUAL; tree clean).
Status: all autonomous core slices FM-00..FM-24 complete with scoped pushed checkpoints. FM-25 is PARKED at the genuine owner audio/theme/UI review gate — NOT self-approved, NOT marked complete.

## 1. Final lean check set (one serial pass at the final SHA, ACTUAL results)

- `python3 scripts/build_desktop.py --check` → generated bundle in sync with fragments, clean.
- `node --input-type=module --check < desktop/plugin.js` → ESM syntax OK.
- `node --test tests/*.test.mjs` → **186 tests, 186 pass, 0 fail, 0 cancelled**.
- `.venv/bin/python -m pytest -q` → **147 passed** (isolated temporary SQLite + labelled route doubles).
- Package contract/hash/determinism fixtures included above; artifact re-verified below.
- No full service stack, no browser farm, no downloads, no paid/live provider calls.

## 2. Review manifest (actual artifact)

- Artifact: `/home/node/fluid-music/dist/fluid-music-0.5.0.zip` (gitignored build output; rebuild from the verified SHA with `python3 scripts/package.py`).
- Size: 296 074 bytes · 55 members · one installable `fluid-music/` directory.
- Archive SHA256: `89a17c00a23e4fdec994153776ddb3bcbbbbbf09a86a40f05dea181a02b802c6` (sidecar `dist/fluid-music-0.5.0.zip.sha256` matches).
- `BUILD-INFO.json` inside the archive: version 0.5.0, `source_sha 1a52f0892ab8c740b876046c01673aa45226fcf6`, branch docs/cloud-kanban-handoff, per-file SHA256 for all 54 content files — every hash re-verified after generation.
- Content: current backend (plugin_api/local_library/providers incl. owned Spotify + token store), all nine renderer fragments + generated plugin.js, plugin.yaml/manifest/pyproject (0.5.0), build script, README/LICENSE, reconciled architecture/limitations/COMPATIBILITY, release-0.5.0 guide, FM-00..FM-24 receipts. NO secrets, real DB/history/media/cache, or internal kanban/import machinery (allowlist + guard, fixture-proven).

## 3. Chain checkpoints (scoped commit per card, all pushed + read-back verified)

FM-00 740d170 · FM-01 a126af3 · FM-02 43978dd · FM-03 92cf1ce · FM-04 133724a · FM-05 c23484d · FM-06 556a62c · FM-07 f3655fe · FM-08 32446aa · FM-09 ebbafd6 · FM-10 ac7ad39 · FM-11 c10c49b · FM-12 42487e5 · FM-13 fc4d7b6 · FM-14 9ac408a · FM-15 bde73c1 · FM-16 c7383e4 · FM-17 f49f2b4 · FM-18 16cb83f · FM-19 68d9d87 · FM-20 68c3fa4 · FM-21 8bae259 · FM-22 85c1d17 · FM-23 eeff0dd · FM-24 1a52f08.
Per-card CALLBACK START/FINISH comments and receipts record files, actual checks, fixture-vs-live limits and verified remote SHAs. FM-20 was resumed after a container restart killed its first worker (stale lock reclaimed, same card, preserved partial work audited and finished).

## 4. Fixture versus live evidence — remaining limitations (honest)

Proven headlessly: queue/occurrence identity, undo determinism, session/resume/bookmark persistence and secrecy, history filters/retention, sleep-timer policy (controlled clock), recovery bounds, migration backup/rollback/busy safety, SDK contract N/N+1/absent doors, packaging content/hash/determinism, one-engine transitions and disposal via labelled doubles.

NOT proven (explicit owner acceptance): real sound/volume; live YouTube play/pause/seek/volume and embed-denied fallback behavior on the packaged host; live Spotify sign-in/Connect device playback; Windows media access; packaged Electron rendering; chat-switch/focus continuity on the live host; theme/narrow/mini/popover rendering; actual next-Hermes-build compatibility. Cross-host loopback media acceptance is gated (cloud backend URL is not Desktop-reachable). Unknown arbitrary future breaking Hermes releases are not guaranteed.

## 5. Owner review steps

Exact actionable steps are in `docs/release-0.5.0.md` (shipped in the archive) and the CALLBACK REVIEW comment: install from the verified SHA or artifact, then check YouTube transport, a source transition, chat switch, titles/history, main/short-mini/popover bottom controls, theme + 320–390px behavior, and the 0.5.0 queue/session/resume/sleep/recovery flows. Approval authorizes marking FM-25 complete and treating the chain as owner-accepted; rejection returns precise findings to this board (no duplicate cards).
