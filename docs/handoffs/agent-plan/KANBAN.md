# FluidMusic — Hermes Cloud Kanban handoff

Read [EXECUTION_POLICY.md](EXECUTION_POLICY.md) first, then [MASTER_PLAN.md](MASTER_PLAN.md) and [COVERAGE.md](COVERAGE.md). Latest user decisions override stale source design/README instructions.

- Repository: `noxius-studium/fluid-music`; branch: `docs/cloud-kanban-handoff`.
- Full feature source baseline: `d6e2bf2df08ae455ac5b24a581c3f2212060afb0`, not older main. Actual source/backend/renderer are IN THIS BRANCH.
- 26 detailed cards and 40 requirements. FM-00 through FM-25 includes plugin-owned Spotify, YouTube failure diagnosis/integrated fallback, new features and update durability. Continue once implementation is authorized, with real owner review at the end.
- Main and ALL delegated workers: exactly `qwen/qwen4-max:free`; provider verified from actual cloud profile. No alternate-model fallback.
- No Docker/heavy testing. Small serial checks, temporary SQLite, labelled fixtures; no local Windows runtime assumptions, browser downloads, restarts or live account operations.
- Every scoped commit -> push authorized feature branch -> verify remote SHA -> CALLBACK FINISH -> continue without routine permission questions, until done or real owner review. Never push main/tags/releases/catalog as a shortcut.
- Cloud cannot certify real Desktop audio/YouTube/volume/local paths merely by running mocks. Preserve that final review gate rather than weakening the product.

## Safe blocked import

1. Clone/fetch THIS branch on the actual receiving cloud host; bind an existing absolute workspace. Read actual profile config, not a connection display name.
2. Run `python docs/handoffs/agent-plan/import_kanban.py` for a no-write validation/dry-run.
3. Run `python docs/handoffs/agent-plan/test_import_kanban.py` for small helper integrity/guardrail tests. These are not application/audio tests.
4. Actual import needs `--apply --board <actual-board> --assignee <actual-existing-profile> --workspace <absolute-cloud-workspace> --profile-config <actual-config-file> --confirm-repository noxius-studium/fluid-music`. Do not copy these angle-bracket placeholders literally.
5. The importer uses full self-contained Markdown bodies, idempotency keys, exact Qwen/provider task pins, strict parent chain, BLOCKED initial state and read-back verification of bodies/route/parents/zero-runs. It preserves existing board content and writes a resumable local receipt. It does not invoke agents, change profile config, unblock, dispatch or touch the app.
6. Report exact target/card IDs and stop preparation. Start execution only when the user actually authorizes it; once started, continue through authorized slices via callbacks until completion/review, not another routine question after each commit.

## Cards

- [FM-00 — Verify cloud workspace and preserve the real current baseline](kanban/FM-00.md)
- [FM-01 — Reconcile current host SDK/backend compatibility without optional-provider breakage](kanban/FM-01.md)
- [FM-02 — Protect registration-level playback and focus-switch continuity](kanban/FM-02.md)
- [FM-03 — Finish one-engine handoff and correct Up Next lifecycle](kanban/FM-03.md)
- [FM-04 — Preserve and finish integrated YouTube command/state bridge](kanban/FM-04.md)
- [FM-05 — Complete YouTube search, URL resolution and real titles](kanban/FM-05.md)
- [FM-06 — Finish profile-scoped SQLite played history and clear/replay UX](kanban/FM-06.md)
- [FM-07 — Diagnose YouTube catalogue failures with a precise recovery matrix](kanban/FM-07.md)
- [FM-08 — Deliver in-plugin first-party YouTube fallback for eligible embed-denied playback](kanban/FM-08.md)
- [FM-09 — Implement FluidMusic-owned Spotify OAuth, protected tokens and provider client](kanban/FM-09.md)
- [FM-10 — Implement Spotify devices, real transport and supported in-plugin playback capability](kanban/FM-10.md)
- [FM-11 — Implement Spotify catalogue/library/playlist workflows inside FluidMusic](kanban/FM-11.md)
- [FM-12 — Unify working bottom transport and make volume usable everywhere](kanban/FM-12.md)
- [FM-13 — Complete compact Hermes-themed Media workspace and responsive body](kanban/FM-13.md)
- [FM-14 — Finish titlebar popover and dockable mini-player with no extra YouTube pane](kanban/FM-14.md)
- [FM-15 — Preserve radio discovery, pins and source-honest LIVE behavior](kanban/FM-15.md)
- [FM-16 — Preserve approved local-library scanning, IDs and seekable playback](kanban/FM-16.md)
- [FM-17 — Complete safe local collections, legacy mixes and import/export continuity](kanban/FM-17.md)
- [FM-18 — Finish dedicated Settings, truthful status and sanitized diagnostics](kanban/FM-18.md)
- [FM-19 — Close keyboard, icon, error and disposal gaps across all surfaces](kanban/FM-19.md)
- [FM-20 — Add queue edit/undo/provenance and resumable listening sessions](kanban/FM-20.md)
- [FM-21 — Add long-form bookmarks/resume, history filters and sleep timer](kanban/FM-21.md)
- [FM-22 — Harden recovery, source health, retry bounds and data-safe restart](kanban/FM-22.md)
- [FM-23 — Make Hermes-update compatibility explicit and remove fragile provider/host coupling](kanban/FM-23.md)
- [FM-24 — Build a complete cloud-to-Desktop artifact and reconcile stale docs](kanban/FM-24.md)
- [FM-25 — Run final lean checks and request owner playback/theme review](kanban/FM-25.md)
