# FM-21 receipt — Long-form bookmarks/resume, history filters and sleep timer

Task: FM-21 (t_89cbd2bb) · Board: fluid-music · Card: `kanban/FM-21.md`
Requirements: F16, F24, F35, F36, F37 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 68c3fa4fa99139371156e732cdf8bdca0c65bf6e (remote read-back equal; tree clean).

## 1. Implemented scope

### History discovery (F16/F36)
- Backend `list_history` gains title (case-insensitive, LIKE-wildcards escaped), source, since/until (YYYY-MM-DD, until inclusive of the whole day) filters with filtered totals and the same stable `played_at DESC, id DESC` pagination. Invalid source/date are honest `ValueError`s surfaced as sanitized route errors.
- `DELETE /history/{id}` removes one entry; `GET/PUT /history/retention` exposes an explicit preference (0 = forever, 30, 90, 365 days). Retention prunes on change AND on every record; the existing 5000-entry cap is retained. No media, queue or credential is ever touched.
- HistoryPage: filter toolbar (title/source/since/until with Apply/Reset), 50-per-page Back/Next pager with page copy, per-entry Remove behind a scoped Confirm, Clear behind the existing scoped Confirm, retention copy pointing at Settings › Playback. Settings › Playback gains the HistoryRetention select with busy/error states.

### Resume and bookmarks (F36) — eligible long-form YouTube/local only (≥ 10 min; LIVE radio never seekable; Spotify position provider-owned)
- New profile-local SQLite tables `resume_positions`, `bookmarks`, `plugin_settings` (CREATE IF NOT EXISTS beside the existing schema; versioned legacy data untouched). Keys are safe `youtube:<videoId>` / `local:<localTrackId>` references validated by charset/length — raw paths, URLs, whitespace and control characters are rejected. Positions bounded 0–86 400 000 ms; labels sanitized ≤ 120 chars; caps: 500 resume rows, 50 bookmarks/item, 2000 total.
- Controller: explicit Resume/Start-over offer in the shared transport when a saved position ≥ 15 s and not near the end exists — NEVER an automatic seek or autoplay. Throttled (15 s) position saves from local timeupdate / YouTube state reports, forced saves on pause and before engine switch, delete on ended. Bookmark add/edit/delete/jump with sorted timestamps and reload round-trip.
- Routes: `GET/PUT/DELETE /resume`, `GET/POST /bookmarks`, `PUT/DELETE /bookmarks/{id}` — all off-event-loop via anyio, sanitized errors.

### Sleep timer (F37) — one controller owner, monotonic, source-aware
- `armSleepTimer('duration', 15/30/60/custom 1–720)` uses a monotonic deadline (`performance.now` fallback `Date.now`) and ONE 1 s tick; remaining mm:ss shows in the shared bottom bar with Cancel. Expiry pauses ONLY the bound current engine (local audio.pause, radio stop, YouTube sink pauseVideo, Spotify `/pause` to the bound device).
- End-of-item intercepts local `ended`, YouTube ended reports and the Spotify projected-end anchor: pauses instead of advancing, consumes the advance guards, and a `sleepEndedFor` flag keeps repeated local ended reports inert; normal playback resets it. LIVE radio end-of-item is refused honestly (duration still works).
- Explicit source-change policy: the timer is bound to the item at arm time; switching items cancels it immediately with honest copy, and the tick re-checks the binding — it can never take over another device later. Session-only: nothing persisted, nothing restored on reload; disposal clears the interval.
- UI: `PlayerExtras` row inside the existing BottomTransport grid (`grid-column:1/-1` — approved 68/96/112px bar geometry unchanged), sleep Modal with presets/custom/end-of-item/Cancel, bookmark Modal with add/edit/delete/jump, resume offer with Resume/Start over. New semantic `clock`/`bookmark`/`edit` icons in the existing stroke vocabulary; narrow `@container fluid (max-width:580px)` rules; reduced motion preserved.

## 2. Fixtures (labelled, isolated)

- `tests/test_resume_bookmarks.py` (NEW, 6): temporary SQLite repository fixtures — resume upsert/bounds/unsafe-key refusal (paths, spotify keys, whitespace, control chars, overlength), bookmark CRUD/caps/sanitization/order, history filters (case-insensitive, escaped wildcards, composing, date boundaries, invalid inputs), stable disjoint pagination, entry removal, retention prune-on-change/prune-on-record/forever-keeps/invalid choices; route fixtures reusing the labelled host doubles from test_plugin_api (filters, entry delete, retention, resume/bookmark round-trips, sanitized errors).
- `tests/resume-sleep.test.mjs` (NEW, 12): controlled monotonic clock + captured intervals + fake Audio/URL + in-memory backend mirror — pure eligibility/keys/bounds/formatting; duration expiry pauses only the current engine; cancel/bounds honest; source-change cancellation with no delayed takeover; local/YouTube end-of-item pause-not-advance with repeated-ended inertness and a positive control preserving normal advance; radio end-of-item refusal; Spotify expiry issues exactly one bound-device pause; explicit resume offer (no auto-seek), Resume seeks, Start over deletes+zeroes, ineligible/near-start never offer; throttled/forced saves and delete-on-ended; bookmark CRUD/jump/reload; history filters/pagination/entry removal/retention/scoped clear; session-only timer + disposal; static UI anatomy incl. unchanged bar geometry and narrow rules. Condition-based `waitFor`/`settle` helpers avoid flush-count races under parallel load.
- Harness maintenance (mechanical): all 16 controller-extraction harnesses threaded with the 7 new pure symbols (`isLongFormEligible`, `mediaKeyFor`, `normalizeResumePosition`, `normalizeBookmark`, `formatPositionMs`, `boundedSleepMinutes`, `SLEEP_MAX_CUSTOM_MIN`).

## 3. Changed files

- `dashboard/local_library.py` — schema additions, safe-key/position/label/date validators, filtered history, entry delete, retention, resume/bookmark repositories.
- `dashboard/plugin_api.py` — history filter params + 10 new/extended routes.
- `desktop/src/10-model.js` — pure eligibility/key/normalization/format/bounds helpers.
- `desktop/src/30-controller.js` — resume/bookmark/sleep/history use cases + engine hooks (startSelected, toggle, local events, YouTube state, Spotify projected-end, disposal).
- `desktop/src/44-workspace.js` — HistoryPage, HistoryRetention, PlayerExtras, BottomTransport integration.
- `desktop/src/20-styles.js` — scoped CSS + narrow rules + clock/bookmark/edit icons.
- `desktop/plugin.js` — regenerated (`--check` clean, ESM OK).
- `tests/resume-sleep.test.mjs`, `tests/test_resume_bookmarks.py` — NEW; 16 harnesses symbol-threaded.
- This receipt.

## 4. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **170 tests, 170 pass, 0 fail** (five consecutive full runs after fixture hardening; the very first combined run showed one transient failure whose output was not captured — the new file's fixed flush-count waits were replaced with condition-based waits, after which all runs are clean; new file alone: 12/12 × 3).
- `.venv/bin/python -m pytest -q` → **136 passed** (130 prior + 6 new).
- `python3 scripts/build_desktop.py` + `--check` → bundle in sync, clean.
- `node --input-type=module --check < desktop/plugin.js` → ESM syntax OK.
- Serial lightweight suite only; no downloads/Docker/paid calls/live providers.

## 5. Fixture versus live evidence

Controlled-clock/headless doubles and isolated temporary SQLite prove logic, bounds, persistence and policy — NOT real sound, real seek behavior of the YouTube iframe or packaged Electron media, live Spotify Connect device pause, live provider availability, or rendered UI/keyboard at 320–390px. Spotify end-of-item uses the EXISTING projected-end anchor mechanism (projection, not a provider ended event) — documented limitation. All live boundaries remain explicit FM-25 owner acceptance.

## 6. Protected paths (untouched)

.env/auth/token stores, real plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases, Spotify transport semantics, legacy playlist raw preservation, historical docs, unrelated fragments, FM-20 queue/session behavior (158 prior fixtures still pass).

## 7. Remaining acceptance and next card

- Owner review of resume/bookmark/sleep/history flows, real seek and narrow rendering: FM-25 (t_0bbb3bc2).
- Commit SHA/parent/author and verified remote SHA: recorded in the CALLBACK FINISH comment.
- Next existing card: FM-22 (t_0c4b41ed) — recovery, source health, retry bounds and data-safe restart.
