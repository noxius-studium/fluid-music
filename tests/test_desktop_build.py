from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_desktop_runtime_is_built_from_modular_sources() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "build_desktop.py"), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert sorted(path.name for path in (ROOT / "desktop" / "src").glob("*.js")) == [
        "00-runtime.js",
        "10-model.js",
        "20-styles.js",
        "30-controller.js",
        "40-ui.js",
        "41-library.js",
        "42-playlists.js",
        "43-visualizer.js",
        "44-workspace.js",
    ]
