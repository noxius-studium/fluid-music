from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_catalog_proposer_is_release_pinned_and_supports_first_listing() -> None:
    workflow = (ROOT / ".github" / "workflows" / "catalog-update.yml").read_text(
        encoding="utf-8"
    )

    assert "workflow_dispatch:" in workflow
    assert "HERMES_CATALOG_TOKEN" in workflow
    assert "gh release view" in workflow
    assert "git rev-list -n 1" in workflow
    assert 'CATALOG_STATE="add"' in workflow
    assert 'CATALOG_STATE="update"' in workflow
    assert "scripts/update_hermes_catalog_entry.py" in workflow
    assert "repos/Deadtrix21/hermes-agent/merge-upstream" in workflow
    assert "gh pr create --repo NousResearch/hermes-agent" in workflow
    assert "docs/images/fluidmusic-workspace.png" in workflow
    assert "personal-use and use-at-your-own-risk notice" in workflow


def test_production_readme_has_pinned_installation_images_and_download_notice() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    for image in (
        "fluidmusic-workspace.png",
        "fluidmusic-youtube-download.png",
        "fluidmusic-titlebar-player.png",
        "fluidmusic-mobile.png",
    ):
        assert (ROOT / "docs" / "images" / image).is_file()
        assert f"docs/images/{image}" in readme
    assert "## Production installation" in readme
    assert "--ref <full-40-character-commit-sha>" in readme
    assert "personal use only" in readme
    assert "Use it entirely at your own risk." in readme
