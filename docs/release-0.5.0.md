# FluidMusic 0.5.0 — cloud-to-Desktop artifact and owner review guide

Written: 2026-11-19 (UTC) · Branch: `docs/cloud-kanban-handoff` (authorized non-main push target)
This release completes the FM-00..FM-24 execution chain. FM-25 is the genuine
owner audio/theme/UI review gate; nothing here self-approves it.

## What shipped since 0.4.1

- **FM-20** Queue editing (Play next, multi-select remove/move, confirmed clears, one-step undo) with display-only provenance; named resumable listening sessions with Replace/Append restore review.
- **FM-21** Long-form resume + timestamp bookmarks (eligible YouTube/local ≥ 10 min), history title/source/date filters + pagination + retention + per-entry removal, source-aware monotonic sleep timer (15/30/60/custom/end-of-item).
- **FM-22** Evidence-based Recovery center, bounded retries/cooldowns with provenance, versioned SQLite migrations with bounded backup/rollback and busy retry, data-safe restart/disposal.
- **FM-23** Declared host contract v1, guarded optional SDK doors (Button/titlebar/navigate), precise data-safe incompatibility fallback, N/N+1 compatibility fixtures.
- **FM-24** This artifact: hardened deterministic packaging with BUILD-INFO hash binding, reconciled README/architecture/limitations, version 0.5.0.

Earlier chain work (FM-00..FM-19) preserved registration-level playback continuity, the one-engine YouTube embed host + capability-gated first-party watch fallback, FluidMusic-owned Spotify OAuth/Connect, SQLite history/local library/collections, the shared bottom transport, titlebar/mini-player, radio honesty, Settings/diagnostics and keyboard/disposal hardening. See `docs/handoffs/agent-plan/receipts/` (shipped in the archive) for per-card evidence.

## Build and verify (from the verified source commit)

The exact source SHA is recorded in the FM-24 CALLBACK FINISH on the
`fluid-music` kanban board and inside the archive's `BUILD-INFO.json`
(`source_sha`, `branch`, per-file `file_sha256`). Verify before installing:

```sh
git ls-remote origin refs/heads/docs/cloud-kanban-handoff   # must equal the recorded SHA
python scripts/build_desktop.py --check
node --input-type=module --check < desktop/plugin.js
node --test tests/*.test.mjs
python -m pytest -q
python scripts/package.py        # prints archive path + sha256; writes .sha256 sidecar
```

The archive is deterministic: rebuilding from the same commit reproduces the
same bytes and the same SHA256. `dist/` is build output, never committed.

## Install on Hermes Desktop (owner action)

The Linux cloud workspace is build/verification provenance only — it is not
the Desktop install location, and no cloud absolute path is a runtime path.

Option A — from the verified commit:

```sh
hermes plugins install noxius-studium/fluid-music --ref <full-40-character-SHA-from-BUILD-INFO>
```

Option B — from the artifact: extract the archive's single `fluid-music/`
folder into the Desktop profile's `$HERMES_HOME/plugins/` directory.

Then enable **FluidMusic** under **Settings → Plugins** and reload desktop
plugins (restart Hermes Desktop only if your host requires it). Review the
dependency/enablement prompts. Do not install a second standalone copy.

## Owner review steps (FM-25 gate)

1. **Sources:** play one Spotify Connect track (after Connect Spotify sign-in), one radio station, one indexed local track, one YouTube video. Confirm the shared bottom bar controls each source honestly; radio shows LIVE with no fake seek.
2. **YouTube boundaries:** try an embed-denied video; confirm the honest failure/recovery copy and, if your host provides the owned-view capability, the first-party watch fallback with one engine and retained queue position.
3. **Queue/sessions:** Play next, multi-select remove/move, clear upcoming vs all, undo; save a listening session, restore with Replace and Append, confirm unavailable-item preview and no autoplay.
4. **Resume/bookmarks:** play a ≥ 10-minute local/YouTube item, pause, reselect — confirm the explicit Resume/Start-over offer; add/edit/jump/delete a bookmark.
5. **History/sleep:** filter history by title/source/date, page, remove one entry, set retention; arm a 15-minute and an end-of-item sleep timer, confirm remaining time, Cancel, and source-change cancellation.
6. **Recovery:** open Settings → Recovery; confirm evidence-based rows, bounded Retry cooldown copy, and sanitized Copy diagnostics.
7. **Theme/UI:** switch Hermes themes (including a tinted one), check 320–390px narrow layouts, keyboard-only traversal, focus return, reduced motion, titlebar popover and mini-player (YouTube viewport minimum respected).

## Explicitly unverified (headless cloud boundary)

Real sound/volume, live YouTube embedding/consent and provider restrictions, packaged Electron rendering, Windows media access, live Spotify/YouTube account behavior, and actual next-Hermes-build compatibility are NOT proven by the cloud fixtures. They are the FM-25 owner acceptance above. Unknown arbitrary future breaking Hermes releases are not guaranteed; an incompatible host shows a precise recovery surface and never deletes saved data.

## Safety

No secrets, real databases, history, media or caches are in the archive (allowlist + guard, fixture-proven). Spotify tokens stay in the protected profile-local store. Installing 0.5.0 migrates the profile-local SQLite schema with a bounded backup and rollback; raw legacy collections are preserved byte-for-byte. Nothing autoplays at startup.
