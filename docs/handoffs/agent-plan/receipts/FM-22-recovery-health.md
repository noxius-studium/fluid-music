# FM-22 receipt — Recovery, source health, retry bounds and data-safe restart

Task: FM-22 (t_0c4b41ed) · Board: fluid-music · Card: `kanban/FM-22.md`
Requirements: F14, F18, F23, F26, F30, F38, F40 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 8bae25952860eacd5b9935bb4402e1778f0b39e4 (remote read-back equal; tree clean).

## 1. Implemented scope

### One quiet recovery center (F23/F38)
- New Settings secondary tab **Recovery** (no new primary tab): per-source health rows for spotify/youtube/local/radio/backend with state (`ready`/`degraded`/`unavailable`/`unknown`), sanitized detail, suggested action and last-evidence timestamp. Rows start at "No evidence yet" and update ONLY from real events — request failures/successes, classified Spotify failures, auth status, YouTube player reports, radio stream boundaries, local library reads. Never a fake all-online badge.
- Actions: bounded Retry per source (retrySpotify/retryYouTube/retryRadio/rescan/refresh), Reconnect when Spotify auth expired, Rescan for local, Skip (advances the queue once, never edits provider playlists), Copy diagnostics (feature-detected clipboard with honest fallback) and Open diagnostics. Cooldown remaining is shown on the Retry button.

### Bounded retries and provenance (F38)
- Pure deterministic retry gate: 3 attempts per window, then a 30 s monotonic cooldown; attempts reset after cooldown. Per-source budgets in one controller owner; `retryYouTube` (previously unbounded) now gated, plus new `retryRadio`/`retrySpotify` through the SAME serialized coordinator. Every retry emits an immutable sanitized `recovery.retry` log entry (attempt + cooldown). No automatic retry loops after provider expiry.

### Data-safe persistence (F40)
- `PRAGMA user_version` migration to target 2. Before migrating a database that HAS data: WAL checkpoint + bounded file backup (`*.backup-v<from>-<stamp>`, newest 3 kept). Migration applies the idempotent schema and bumps the version atomically; on ANY failure it rolls back via the SQLite online backup API into the live connection and re-raises — version stays unbumped, raw rows byte-for-byte intact, retry possible. Fresh empty databases skip the backup. Reopening a migrated database is idempotent (no new backup).
- Bounded busy/locked retry (`_run_busy`: 2 extra attempts, 0.25 s delay) on the hot `record_history` write path; other writes keep the existing 15 s SQLite busy timeout and sanitized route errors. No partial or duplicate rows from busy periods.
- Raw legacy preservation unchanged: renderer raw playlist roots and backend payload_json are never rewritten by migration.

### Restart/disposal safety (F14/F18/F30)
- Restart loads the durable queue paused: no engine created, no transport command, no autoplay (fixture-proven). Disposal clears every interval (including the FM-21 sleep tick); late timer work after disposal is inert. Single-engine/serialized-transition ownership from FM-03/FM-19 preserved.

## 2. Fixtures (labelled, isolated)

- `tests/recovery-health.test.mjs` (NEW, 9): controlled clock + fault-injecting backend mirror — pure retry-gate/health normalization bounds; retryYouTube 3-attempt bound + cooldown refusal + reset + provenance; per-source budgets and coordinator routing; health evidence lifecycle (unknown → unavailable → ready, Spotify 401 → reconnect with no retry storm, YouTube error row, radio network-boundary row, local ready); offline faults leave queue/history untouched; data-safe restart (paused, no engine, no play command); disposal clears timers and late work is inert; sanitized copyDiagnostics; static Recovery UI anatomy incl. no new primary tab and narrow rules.
- `tests/test_data_safe_migrations.py` (NEW, 6): temporary SQLite only — fresh DB reaches v2 with all tables and no needless backup; legacy v0 migration preserves raw payload byte-for-byte + roots, creates exactly one PRE-migration backup, new structures usable; backups bounded ≤ 3 across repeated migrations; forced invalid-schema migration rolls back (version 0, exact data, backup present) and retry succeeds; busy EXCLUSIVE lock → exactly 2 bounded retries then graceful OperationalError, no partial/duplicate rows, success after unlock; idempotent reopen.
- Harness maintenance (mechanical): all 17 controller-extraction harnesses threaded with `retryGate`, `retryConsumed`, `normalizeHealthRow`, `RETRY_COOLDOWN_MS`. `tests/settings-diagnostics.test.mjs` tab expectation updated to include Recovery; `tests/queue-sessions.test.mjs` bulk-save count made deterministic (48 → exactly 50) to remove a latent millisecond-boundary flake in the FM-20 fixture.

## 3. Changed files

- `dashboard/local_library.py` — `_SCHEMA_SQL` constant, versioned migration with backup/rollback, `_run_busy`, record_history busy wrapper.
- `desktop/src/10-model.js` — pure retry gate + health-row normalization + constants.
- `desktop/src/30-controller.js` — sourceHealth/retryState atoms, recordHealth evidence hooks (request, Spotify refresh/auth, local library, radio, YouTube, watch capability), tryRetry/retryRadio/retrySpotify, retryYouTube gate, copyDiagnostics.
- `desktop/src/44-workspace.js` — RecoveryPage + Settings Recovery tab.
- `desktop/src/20-styles.js` — health-row CSS + narrow rules.
- `desktop/plugin.js` — regenerated (`--check` clean, ESM OK).
- `tests/recovery-health.test.mjs`, `tests/test_data_safe_migrations.py` — NEW; 17 harnesses symbol-threaded; two fixture expectations corrected.
- This receipt.

## 4. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **179 tests, 179 pass, 0 fail, 0 cancelled** (two consecutive full runs).
- `.venv/bin/python -m pytest -q` → **142 passed** (136 prior + 6 new).
- `python3 scripts/build_desktop.py --check` → bundle in sync, clean.
- `node --input-type=module --check < desktop/plugin.js` → ESM syntax OK.
- Serial lightweight suite only; no downloads/Docker/paid calls/live providers.

## 5. Fixture versus live evidence

Fault injection uses labelled doubles and isolated temporary SQLite. NOT proven here: real offline/network behavior of the packaged host, real SQLite contention under Desktop load, live provider expiry/reconnect flows, rendered Recovery UI/keyboard at 320–390px, actual Hermes reload/disable lifecycle. Migration/rollback are proven against real SQLite engines in temp files; packaged-host acceptance remains explicit FM-25.

## 6. Protected paths (untouched)

.env/auth/token stores, real plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, provider transport semantics, legacy raw preservation, historical docs, FM-20/FM-21 behavior (all prior fixtures pass).

## 7. Remaining acceptance and next card

- Owner review of Recovery UI, real fault behavior and packaged-host restart: FM-25 (t_0bbb3bc2).
- Commit SHA/parent/author and verified remote SHA: recorded in the CALLBACK FINISH comment.
- Next existing card: FM-23 (t_6ef84414) — Hermes-update compatibility and provider/host coupling.
