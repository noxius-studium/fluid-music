# Contributing to FluidMusic

## Set up

Use Python 3.12+ (runtime minimum 3.11) and Node.js 24. Install verification dependencies from the checked-in locks:

```sh
python -m venv .venv
# Activate .venv using your shell's normal activation command.
python -m pip install -r requirements-dev.txt
npm ci
npx playwright install chromium
```

On Linux CI use `npx playwright install --with-deps chromium` to install Chromium's system dependencies too.

## Change and verify

Edit `desktop/src/*.js`, not the generated runtime alone. After changing fragments:

```sh
python scripts/build_desktop.py
python scripts/build_desktop.py --check
node --check desktop/plugin.js
npm test
npm run test:ui
python -m pytest -q
python -m ruff check dashboard tests scripts
python -m compileall -q dashboard scripts
python scripts/package.py
```

Include the regenerated `desktop/plugin.js` in your commit. Browser tests exercise this actual module with a fixture SDK, synthetic provider responses and real Chromium audio. They require no Spotify credentials. Evidence is written to ignored `.hermes-tests/`.

Use `uv pip compile pyproject.toml --extra test --generate-hashes --output-file requirements-dev.txt` to update the Python verification lock deliberately. Use `npm install --save-dev --save-exact` to update Node tooling and commit both npm manifests.

## Pull requests

Describe the problem, behavior changes, verification commands and remaining limitations. Include a failing regression or explain why a characterization test is appropriate. Keep provider capabilities truthful and preserve duplicate queue occurrences, local-library IDs, cancellation and restart behavior.

Do not add secrets, personal listening data, local backups, absolute user paths or screenshots of private sessions. Use synthetic fixtures for public screenshots. Changes must pass CI. Host protocol changes and new providers need separate design review; a plugin UI change is not permission to change Hermes security boundaries.

## Releases

Keep `plugin.yaml`, `pyproject.toml` and `dashboard/manifest.json` versions synchronized. Build the unified ZIP with `scripts/package.py`; do not publish the Python wheel as a complete Hermes plugin. Validate the extracted ZIP with `hermes plugins validate <extracted-directory> --json`, then test the installed artifact in Hermes during an explicitly agreed playback break. A plugin reload may interrupt listening.

Publish a version tag and release only after exact-commit CI and live acceptance. Attach the tested ZIP and its SHA-256 checksum. Do not include `.hermes-tests/` or dependency caches in the release.

Contributions are distributed under the repository's existing CC BY-NC 4.0 license; this project is public but not licensed for unrestricted commercial use.
