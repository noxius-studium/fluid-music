# FM-24 receipt — Complete cloud-to-Desktop artifact and stale-doc reconciliation

Task: FM-24 (t_e8abaa89) · Board: fluid-music · Card: `kanban/FM-24.md`
Requirements: F01, F02, F09, F13, F25, F26, F28, F29, F30 · Written: 2026-11-19 (UTC)
Profile: default · Provider: nous · Main + delegated model pin: qwen/qwen4-max:free (no delegation used).
Repository: noxius-studium/fluid-music · Workspace: /home/node/fluid-music · Branch: docs/cloud-kanban-handoff
Start SHA: eeff0dd5f3ed55f84e71e899c86594cc6086c9eb (remote read-back equal; tree clean).

## 1. Implemented scope

### Hardened deterministic packaging (`scripts/package.py`)
- Release docs are an explicit owner-facing allowlist: `docs/architecture.md`, `docs/limitations.md`, `docs/handoffs/agent-plan/COMPATIBILITY.md`, execution receipts (`receipts/*.md`) and `docs/release-*.md`. Internal kanban cards, import machinery, local payloads, execution policy and master plan are deliberately NOT release content.
- Generated `BUILD-INFO.json` archive member binds product version, `source_sha` (git HEAD at packaging time), branch and per-file SHA256 for every content file; written first so archive order stays fully sorted/deterministic (fixed 1980 timestamps preserved).
- Archive SHA256 sidecar (`<name>.zip.sha256`) + stdout digest line.
- Content guard: secret DATA patterns (`.env*`, token/credential/secret JSON, keys/certs), real databases (`.sqlite`/`.db`/`plugin-data`), media/image suffixes, caches (`__pycache__`, `node_modules`, `.git`) and nested zips are rejected. Source CODE modules such as `providers/token_store.py` remain required content (guard distinguishes code from secret data).
- Required runtime contract unchanged and complete: plugin.yaml, `__init__.py`, pyproject.toml, dashboard (manifest/api/library/providers incl. token_store + spotify), all nine renderer fragments + generated plugin.js, build script, README, LICENSE.

### Version and metadata
- 0.4.1 → **0.5.0** in plugin.yaml, dashboard/manifest.json and pyproject.toml (fixture-enforced consistency). plugin.yaml description now includes YouTube.

### Stale-doc reconciliation
- **README.md**: owned-Browser capture flow → capability-protected loopback embed host + capability-gated first-party watch fallback; "Hermes-managed Spotify PKCE" → FluidMusic-owned OAuth/protected token store; provider table, queue-control and Browse/YouTube sections updated; new 0.5.0 feature section (queue editing/sessions/resume/bookmarks/history/sleep/recovery/host contract); heavy verification steps (npm ci / playwright install / esbuild bundle / plugins validate) replaced by the small serial suite with an explicit note that `tests/ui/verify.mjs` is legacy and not required; install section states the Linux-cloud-workspace vs Desktop-install boundary and reload-first guidance.
- **docs/architecture.md**: YouTube adapter diagram + section rewritten to the embed host/relay + capability-gated fallback (no private preview bridge); Spotify credential authority corrected to the owned provider/token store with real route names (`/playlists`, `/playlists/{id}/tracks`); private-palette paragraph superseded by Hermes semantic-variable rules; capability matrix and security bullets updated; new 0.5.0 architecture summary.
- **docs/limitations.md**: Spotify credential ownership corrected; "patched Hermes Desktop preview contract" YouTube section replaced by honest embed-host/fallback boundaries incl. cross-host loopback gating and viewport minimum; new 0.5.0 limitation list (sessions/resume/sleep/recovery/compatibility).
- **NEW docs/release-0.5.0.md**: owner-facing build/verify/install/review guide — source-SHA verification via ls-remote + BUILD-INFO, deterministic rebuild, Desktop install options, exact FM-25 review steps, explicit unverified live boundaries, safety notes. No machine-specific absolute runtime paths.

### Fixtures
- NEW `tests/test_release_package.py` (5): content contract + internal-machinery exclusion, forbidden-path guard (code vs secret data), deterministic byte-identical rebuild + sidecar + BUILD-INFO per-file hash verification, version consistency, stale-instruction regression statics.
- `tests/test_plugin_api.py` release-tree test updated for the two-line stdout (path + sha256); sorted-order invariant preserved by writing BUILD-INFO first.

## 2. Changed files

scripts/package.py · plugin.yaml · dashboard/manifest.json · pyproject.toml · README.md · docs/architecture.md · docs/limitations.md · NEW docs/release-0.5.0.md · NEW tests/test_release_package.py · tests/test_plugin_api.py · this receipt. No backend/provider logic or renderer behavior changes.

## 3. Checks and ACTUAL results

- `.venv/bin/python -m pytest -q` → **147 passed** (142 prior + 5 new packaging fixtures).
- `node --test tests/*.test.mjs` → **186 pass / 0 fail / 0 cancelled**.
- `python3 scripts/build_desktop.py --check` → bundle in sync; `node --input-type=module --check` → ESM OK.
- Artifact generated AFTER the scoped commit so BUILD-INFO binds the final source SHA; archive path + SHA256 recorded in the CALLBACK FINISH comment (dist/ is gitignored build output, never committed). Rebuild determinism fixture-proven.
- No install, no release/catalog publication, no host-runtime change, no doctor, no downloads/Docker/paid calls.

## 4. Fixture versus live evidence

Packaging/content/hash/determinism checks run against the real source tree with stdlib zipfile into isolated temp paths. NOT proven here: actual Hermes Desktop installation, packaged rendering, live provider playback — the FM-25 owner review guide in docs/release-0.5.0.md lists the exact steps.

## 5. Protected paths (untouched)

.env/auth/token stores, real plugin-data/SQLite/user media, Hermes installation/config/gateway, main/tags/releases (no publishing), provider transport semantics, backend logic, legacy raw preservation, historical release notes (0.4.0/0.4.1), FM-20..FM-23 behavior.

## 6. Remaining acceptance and next card

- FM-25 (t_0bbb3bc2) is the FINAL owner audio/theme/UI review gate: emit CALLBACK REVIEW with artifact/SHA and stop for the owner.
- Commit SHA/parent/author, verified remote SHA and artifact SHA256: recorded in the CALLBACK FINISH comment.
