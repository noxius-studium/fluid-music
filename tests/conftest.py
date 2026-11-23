"""Shared pytest fixtures for the FluidMusic test suite.

Loading ``test_plugin_api`` as a plugin makes its labelled doubles available
by name without importing them into individual test modules (imports that
Ruff correctly flags as shadowed by fixture parameters).
"""

pytest_plugins = ["test_plugin_api"]
