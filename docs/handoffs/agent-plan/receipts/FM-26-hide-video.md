# FM-26 receipt — mini-player hide-video toggle (owner follow-up)

Task: FM-26 (t_a4839644) · Board: fluid-music · Written: 2026-11-23 (UTC)
Owner basis: 2026-11-21 feedback item 1 + 2026-11-23 resume ("do NOT just re-park at review").
Profile: default · Provider: nous · Active route: tencent/hy4-flash:free (qwen pin SUSPENDED for this push). No delegation (host cap).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Baseline SHA: 33b8ab79a912d14744bb3925182fab74c2617c98 (FM-25 review gate, verified ancestor).

## What changed

- `desktop/src/30-controller.js`: new `youtubeVideoHidden` atom (storage-backed, survives reload) and `toggleYouTubeVideo(value)`; both exported. Hiding touches NO transport command and NO engine state.
- `desktop/src/43-visualizer.js`: `MiniPlayer` reads the atom, adds `fluid-video-hidden` on the YouTube section and a keyboard-reachable `fluid-video-toggle` button (`aria-pressed`, "Hide video"/"Show video") OUTSIDE the hidden frame.
- `desktop/src/20-styles.js`: `.fluid-video-hidden .fluid-youtube-frame-wrap{display:none}` — the iframe/host view stays MOUNTED so the ONE active engine keeps decoding audio; the command sink stays bound. The 200x200 minimum and short-pane expand note are retained (expand note suppressed while video is hidden).
- `desktop/plugin.js`: regenerated with `scripts/build_desktop.py`.
- `tests/hide-video.test.mjs` (new) + `tests/titlebar-mini.test.mjs` (controller test added): labelled fixtures for state/persistence, no-media-command, DOM/CSS contract and no second/Browser surface.
- `tests/test_resume_bookmarks.py`: pre-existing time-bomb fixture made deterministic with the existing `backdate` helper (hardcoded 2026-11-19 vs real clock). Test-only; no product change.

## Checks (actual)

- `python3 scripts/build_desktop.py` then `--check` → bundle in sync, clean.
- `node --input-type=module --check < desktop/plugin.js` → ESM syntax OK.
- `node --test tests/*.test.mjs` → 189 pass / 0 fail / 0 cancelled (was 186 + 3 new).
- `.venv/bin/python -m pytest -q` → 147 passed (fixture stabilized; 146 + 1 previously failing now pass).
- No Docker/stacks/downloads/live provider or paid calls. Fixtures are labelled cloud doubles.

## Honest boundaries

- Fixtures prove state, persistence, DOM/CSS hiding and absence of transport commands. They do NOT prove real YouTube audio continuing while hidden or packaged Electron rendering — both remain owner review on the Desktop artifact.

Next: FM-27 (t_b6e35f3d) real yt-dlp audio-only fallback.
