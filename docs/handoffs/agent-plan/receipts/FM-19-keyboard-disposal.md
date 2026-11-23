# FM-19 receipt — Keyboard, icon, error and disposal gaps across all surfaces

Task: FM-19 (t_7e3c4120) · Board: fluid-music · Card: `kanban/FM-19.md`
Requirements: F10, F12, F14, F17, F23, F24 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: 16cb83f116a42ea674f6dc0e28d60afc7dd89c0d (remote read-back equal; tree clean).

## 1. Real gaps found and fixed (minimal controller guards only)

1. `refreshQueuedYouTubeMetadata` kept mutating queue/youtube atoms and persisting after disposal (async loop had no disposed guard). Now returns before each iteration and after the await, and only persists while alive.
2. `setYouTubeCommandSink` accepted sink registration after disposal. Now refuses registration once disposed.
3. `onDispose` did not release the YouTube command sink. Now nulls it alongside timers/audio/object-URL cleanup.

No broad rewrite; no other production change.

## 2. Audit result — already contract-compliant (fixture-proven, unchanged)

- One semantic Icon set (decorative icons `aria-hidden`); every icon-only Action named (`aria-label` + `title`); TrackRow select/play/add actions named per item.
- Keyboard: native buttons/ranges; SeekBar commits on the full arrow/Home/End/PageUp/PageDown vocabulary; volume ranges announce `aria-valuetext`; tabs `role=tablist`/`aria-selected`.
- Dialogs: native `<dialog>` showModal, Esc via onCancel → owner callback, previous-focus restoration; Confirm busy/error states with `role=alert` — failures never swallowed into success. Popover Esc/outside + trigger-focus restore covered by FM-14 fixtures.
- Reduced motion covers root/mini/titlebar; honest empty/busy/error states across surfaces.
- Session blob-URL ownership is correct as designed: the session/registry owns URLs (queue removal must NOT revoke while LocalPage still lists the file); disposal revokes every URL exactly once. Proven, not changed.
- Transition failures surface as error status + sanitized message; the catch chain is not a blanket success swallow.

## 3. New fixtures

`tests/keyboard-disposal.test.mjs` (NEW, 3, labelled headless doubles incl. fake URL.createObjectURL/revokeObjectURL):
1. Disposal: initialization-started metadata refresh held at a gated resolve, disposed mid-flight → late resolve cannot rewrite queue or persist; stale player reports ignored; late sink registration refused; every timer cleared; every session object URL revoked exactly once; live sink still drives the surface before disposal (positive control).
2. Session ownership: queue removal keeps the blob alive and re-addable; disposal revokes exactly once.
3. Static keyboard/icon/dialog/error anatomy evidence (named actions, aria-hidden icons, range labels/valuetext, seek key vocabulary, native modal focus/Esc/restore, busy/alert states, tab semantics, reduced motion, honest transition catch).

## 4. Changed files

- `desktop/src/30-controller.js` — three disposal guards only.
- `desktop/plugin.js` — regenerated (`--check` clean, ESM OK).
- `tests/keyboard-disposal.test.mjs` — NEW.
- This receipt.

## 5. Checks and ACTUAL results

- `node --test tests/*.test.mjs` → **146 tests, 146 pass, 0 fail, 0 cancelled**.
- `.venv/bin/python -m pytest -q` → **130 passed** (no backend change).
- `build_desktop.py --check` exit 0; bundle ESM syntax OK.
- No downloads/Docker/paid calls/live providers.

## 6. Honest boundaries

- Headless doubles + static proofs only. Real keyboard focus order, screen-reader behavior, rendered pixels and packaged-Desktop disposal timing remain **UNVERIFIED**, gated to FM-25.

## 7. Commit / push

- Commit SHA + parent + verified remote SHA: recorded in the board CALLBACK FINISH for t_7e3c4120 (this receipt is part of that same commit). Author Zero2 <deadtrix21@users.noreply.github.com>; push target docs/cloud-kanban-handoff only.
- Remaining dirty work after commit: none. Carried: FM-22 recovery, FM-23 adapter, FM-24 artifact + stale docs (incl. tests/ui), FM-25 owner review.
- Next card: FM-20 (t_b8b1f7b0) — queue edit/undo/provenance and resumable listening sessions. Continuing serially.
